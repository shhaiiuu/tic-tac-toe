// Edge Function `rooms` — the trusted backend for online play.
// Runs with the service-role key (provided by Supabase to Edge Functions as a secret
// environment variable). That key never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildNewRoom,
  generateCode,
  joinRoom,
  leaveRoom,
  makeMove,
  normalizeCode,
  requestRematch,
  writableColumns,
  type RoomError,
  type RoomResult,
  type RoomRow,
} from "../_shared/rooms.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Domain errors are returned with HTTP 200 + { ok: false, error } so the client can show
// friendly messages; only auth/server failures use non-2xx statuses.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const reply = (r: RoomResult) => json(r.ok ? { ok: true, room: r.row } : { ok: false, error: r.error });
const fail = (error: RoomError | "unauthorized") => json({ ok: false, error });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const randomInt = (max: number) => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
};

/** Read the room, apply a pure rule, write with an optimistic version check (retry on races). */
async function mutate(code: string, rule: (row: RoomRow) => RoomResult): Promise<RoomResult> {
  const mutationStartedAt = performance.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const readStartedAt = performance.now();
    const { data, error } = await admin.from("rooms").select("*").eq("code", code).maybeSingle();
    console.info(
      `[rooms timing] database read attempt ${attempt + 1}: ${Math.round(performance.now() - readStartedAt)} ms`,
    );
    if (error) throw error;
    if (!data) return { ok: false, error: "not_found" };
    const row = data as RoomRow;

    const result = rule(row);
    if (!result.ok || result.row === row) return result; // rejected, or nothing to write

    const writeStartedAt = performance.now();
    const { data: updated, error: updateError } = await admin
      .from("rooms")
      .update({ ...writableColumns(result.row), version: row.version + 1, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("version", row.version)
      .select("*")
      .maybeSingle();
    console.info(
      `[rooms timing] database write attempt ${attempt + 1}: ${Math.round(performance.now() - writeStartedAt)} ms`,
    );
    if (updateError) throw updateError;
    if (updated) {
      console.info(`[rooms timing] complete mutation: ${Math.round(performance.now() - mutationStartedAt)} ms`);
      return { ok: true, row: updated as RoomRow };
    }
    // Someone else wrote first: reload and re-validate against the fresh state.
  }
  console.info(`[rooms timing] mutation exhausted retries: ${Math.round(performance.now() - mutationStartedAt)} ms`);
  return { ok: false, error: "conflict" };
}

async function createRoom(userId: string, name: unknown, mode: unknown): Promise<RoomResult> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const room = buildNewRoom(generateCode(randomInt), userId, name, mode);
    if (!room) return { ok: false, error: "bad_request" };
    const { data, error } = await admin.from("rooms").insert(room).select("*").single();
    if (!error) return { ok: true, row: data as RoomRow };
    if (error.code !== "23505") throw error; // not a duplicate code -> real failure
  }
  return { ok: false, error: "conflict" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail("bad_request");

  const requestStartedAt = performance.now();
  const authStartedAt = performance.now();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  console.info(`[rooms timing] authentication: ${Math.round(performance.now() - authStartedAt)} ms`);
  const user = auth.user;
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request");
  }

  try {
    if (body.action === "create") return reply(await createRoom(user.id, body.name, body.mode));

    const code = normalizeCode(body.code);
    if (!code) return fail("invalid_code");

    switch (body.action) {
      case "join":
        return reply(await mutate(code, (row) => joinRoom(row, user.id, body.name)));
      case "move": {
        const result = await mutate(code, (row) => makeMove(row, user.id, body.index));
        console.info(`[rooms timing] total move request before response: ${Math.round(performance.now() - requestStartedAt)} ms`);
        return reply(result);
      }
      case "rematch":
        return reply(await mutate(code, (row) => requestRematch(row, user.id)));
      case "leave":
        return reply(await mutate(code, (row) => leaveRoom(row, user.id)));
      default:
        return fail("bad_request");
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
