-- In-game chat for online rooms.
--
-- Security model (all enforced by Postgres, no service-role key involved):
--   * Only the room's host/guest can READ its messages (RLS + is_room_member()).
--   * Only members can INSERT, and only into their own room. The client may only supply
--     (id, room_id, content); a trigger fills in the sender id, display name and timestamp from
--     the authenticated session and the rooms table, validates the text and rate-limits senders.
--   * Messages cannot be updated or deleted by clients.
--   * Typing indicators use PRIVATE Realtime Broadcast channels named chat:<room uuid>, authorised
--     by policies on realtime.messages with the same membership check. They are never stored.
--
-- Rollback: see the commented block at the bottom.

create table public.room_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  sender_id   uuid not null,
  sender_name text not null,
  content     text not null,
  created_at  timestamptz not null default now(),
  constraint room_messages_content_length check (char_length(content) between 1 and 500)
);

create index room_messages_room_created_idx on public.room_messages (room_id, created_at);
create index room_messages_sender_created_idx on public.room_messages (sender_id, created_at);

-- Membership check used by every policy. SECURITY DEFINER so it works regardless of the caller's
-- own table privileges; it only ever answers "is the CURRENT user in this room?".
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id
      and auth.uid() is not null
      and (r.host_id = auth.uid() or r.guest_id = auth.uid())
  );
$$;

revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

-- Fills in / validates everything the client must not control.
create or replace function public.room_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.rooms%rowtype;
  recent integer;
begin
  select * into r from public.rooms where id = new.room_id;

  if not found or auth.uid() is null or not (r.host_id = auth.uid() or r.guest_id = auth.uid()) then
    raise exception 'not_member' using errcode = '42501';
  end if;
  if r.status = 'abandoned' then
    raise exception 'room_closed' using errcode = 'P0001';
  end if;

  new.content := btrim(replace(new.content, E'\r', ''));
  if char_length(new.content) = 0 then
    raise exception 'empty' using errcode = '23514';
  end if;
  if char_length(new.content) > 500 then
    raise exception 'too_long' using errcode = '23514';
  end if;

  -- Simple flood protection: at most 8 messages per sender per 5 seconds.
  select count(*) into recent
  from public.room_messages
  where sender_id = auth.uid() and created_at > now() - interval '5 seconds';
  if recent >= 8 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  new.sender_id   := auth.uid();
  new.sender_name := case when auth.uid() = r.host_id then r.host_name else coalesce(r.guest_name, 'Player 2') end;
  new.created_at  := now();
  return new;
end;
$$;

create trigger room_messages_before_insert
  before insert on public.room_messages
  for each row execute function public.room_messages_before_insert();

alter table public.room_messages enable row level security;

create policy "members read their room chat"
  on public.room_messages for select
  to authenticated
  using (public.is_room_member(room_id));

create policy "members send to their room chat"
  on public.room_messages for insert
  to authenticated
  with check (sender_id = auth.uid() and public.is_room_member(room_id));

-- No update/delete policies, and column-level grants: clients can only ever supply these 3 columns.
revoke all on public.room_messages from anon, authenticated;
grant select on public.room_messages to authenticated;
grant insert (id, room_id, content) on public.room_messages to authenticated;

-- Realtime: stream new messages (filtered by the RLS policy above).
alter publication supabase_realtime add table public.room_messages;

-- Typing indicators: private Broadcast channels "chat:<room uuid>", members only.
create policy "chat broadcast: members can receive"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and case
          when realtime.topic() ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then public.is_room_member(substr(realtime.topic(), 6)::uuid)
          else false
        end
  );

create policy "chat broadcast: members can send"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and case
          when realtime.topic() ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then public.is_room_member(substr(realtime.topic(), 6)::uuid)
          else false
        end
  );

-- ROLLBACK (run manually if you need to undo this migration):
--   drop policy if exists "chat broadcast: members can send" on realtime.messages;
--   drop policy if exists "chat broadcast: members can receive" on realtime.messages;
--   alter publication supabase_realtime drop table public.room_messages;
--   drop table if exists public.room_messages;           -- also drops its trigger and policies
--   drop function if exists public.room_messages_before_insert();
--   drop function if exists public.is_room_member(uuid);
