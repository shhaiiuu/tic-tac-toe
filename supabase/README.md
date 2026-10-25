# Online multiplayer setup (Supabase)

Online play is real client/server play: rooms live in a Supabase Postgres table, moves are
validated by a Supabase Edge Function, and both players receive updates over Supabase Realtime.
Until the steps below are done, **Play Online** shows a "not set up yet" screen instead of
pretending to work. Local play and the computer opponent never need any of this.

## How it works

| Piece | Where | Role |
| --- | --- | --- |
| `rooms` table + RLS | `migrations/20261025000000_online_rooms.sql` | Players can only **read** rooms they belong to. No client can insert, update or delete. |
| `rooms` Edge Function | `functions/rooms/index.ts` | The only writer. Verifies the caller's login, then creates/joins rooms and validates every move (membership, turn, empty cell, Classic/Modern rules) with the same game engine as the app. |
| Anonymous auth | Supabase Auth | Gives each player a real user id with no sign-up. |
| Realtime | `postgres_changes` + presence | Pushes board updates (RLS-filtered) and shows when the other player disconnects. |

The service-role key is only available inside the Edge Function (Supabase injects it as a
secret). The browser only ever has the public URL and publishable/anon key.

## Setup

1. **Project** – create a Supabase project (or enable Lovable Cloud / the Supabase integration).
2. **Database** – run `migrations/20261025000000_online_rooms.sql` in the SQL editor
   (or `supabase db push`).
3. **Auth** – Dashboard → Authentication → Providers → enable **Anonymous sign-ins**.
4. **Server** – `supabase functions deploy rooms` (JWT verification stays on, the default).
5. **Frontend env** – copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (Lovable fills these in automatically). Restart `bun run dev`.
6. `bun install` (adds `@supabase/supabase-js`).

Optional: schedule the cleanup query at the bottom of the migration to delete old rooms.

## Keeping the engine in sync

Edge Functions cannot import from `src/`, so `src/lib/game/{types,engine}.ts` is copied to
`functions/_shared/game/`. After editing the engine run `bun run sync:engine`, then redeploy
the function. A unit test fails if the copies differ.
