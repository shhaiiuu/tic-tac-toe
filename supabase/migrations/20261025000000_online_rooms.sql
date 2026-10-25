-- Online multiplayer rooms for Tic Tac Toe.
--
-- Security model:
--   * Players sign in anonymously (Supabase Auth), so every client has an auth.uid().
--   * Clients may only READ rooms they belong to (RLS). They get live updates through
--     Realtime, which applies the same policy.
--   * Clients can NOT insert/update/delete. All writes go through the `rooms` Edge Function,
--     which runs with the service-role key (server-side only) and validates membership,
--     turns and moves with the shared game engine.

create table public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{5}$'),
  mode        text not null check (mode in ('classic', 'modern')),
  status      text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'abandoned')),
  host_id     uuid not null,
  guest_id    uuid,
  host_name   text not null,
  guest_name  text,
  host_symbol text not null default 'X' check (host_symbol in ('X', 'O')),
  game        jsonb not null,
  round       integer not null default 1,
  scores      jsonb not null default '{"host":0,"guest":0,"draws":0}'::jsonb,
  host_ready  boolean not null default false,
  guest_ready boolean not null default false,
  left_by     text check (left_by in ('host', 'guest')),
  version     integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index rooms_host_id_idx on public.rooms (host_id);
create index rooms_guest_id_idx on public.rooms (guest_id);
create index rooms_created_at_idx on public.rooms (created_at);

alter table public.rooms enable row level security;

-- Members (host or guest) can read their room. Nobody else can.
create policy "members can read their room"
  on public.rooms for select
  to authenticated
  using (auth.uid() = host_id or auth.uid() = guest_id);

-- No insert/update/delete policies on purpose, and no table privileges either.
revoke all on public.rooms from anon, authenticated;
grant select on public.rooms to authenticated;

-- Realtime: stream row changes (filtered by the RLS policy above).
alter publication supabase_realtime add table public.rooms;

-- Optional housekeeping: delete rooms older than a day (enable pg_cron first).
-- select cron.schedule('delete-old-rooms', '0 * * * *',
--   $$ delete from public.rooms where created_at < now() - interval '1 day' $$);
