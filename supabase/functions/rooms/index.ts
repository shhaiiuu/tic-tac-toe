
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
import { BUILD_ID, createTimer, formatTimingLog, type Timer } from "../_shared/timing.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "server-timing, x-request-id, x-rooms-build",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const reply = (r: RoomResult) => json(r.ok ? { ok: true, room: r.row } : { ok: false, error: r.error });
const fail = (error: RoomError | "unauthorized") => json({ ok: false, error });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const bootedAt = Date.now();
const region = Deno.env.get("SB_REGION") ?? Deno.env.get("DENO_REGION") ?? "unknown";
let served = 0;
console.log(`[rooms boot] build=${BUILD_ID} region=${region}`);

const randomInt = (max: number) => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
};

type RoomRead = { data: RoomRow | null; error: unknown };

const readRoom = (code: string, t: Timer): Promise<RoomRead> =>
  t.span("db_read", async () => {
    const { data, error } = await admin.from("rooms").select("*").eq("code", code).maybeSingle();
    return { data: data as RoomRow | null, error };
  });

async function mutate(
  code: string,
  rule: (row: RoomRow) => RoomResult,
  t: Timer,
  ctx: { attempts: number },
  firstRead: Promise<RoomRead>,
): Promise<RoomResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    ctx.attempts++;
    const { data, error } = attempt === 0 ? await firstRead : await readRoom(code, t);
    if (error) throw error;
    if (!data) return { ok: false, error: "not_found" };
    const row = data;

    const result = await t.span("logic", () => rule(row));
    if (!result.ok || result.row === row) return result; // rejected, or nothing to write

    const { data: updated, error: updateError } = await t.span("db_write", async () =>
      admin
        .from("rooms")
        .update({ ...writableColumns(result.row), version: row.version + 1, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("version", row.version)
        .select("*")
        .maybeSingle(),
    );
    if (updateError) throw updateError;
    if (updated) return { ok: true, row: updated as RoomRow };
  }
  return { ok: false, error: "conflict" };
}

async function createRoom(userId: string, name: unknown, mode: unknown, t: Timer, ctx: { attempts: number }): Promise<RoomResult> {
  for (let attempt = 0; attempt < 8; attempt++) {
    ctx.attempts++;
    const room = buildNewRoom(generateCode(randomInt), userId, name, mode);
    if (!room) return { ok: false, error: "bad_request" };
    const { data, error } = await t.span("db_write", async () => admin.from("rooms").insert(room).select("*").single());
    if (!error) return { ok: true, row: data as RoomRow };
    if (error.code !== "23505") throw error; 
  }
  return { ok: false, error: "conflict" };
}

interface Outcome {
  action: string;
  ok: boolean;
  error: string | null;
  attempts: number;
}

async function handle(req: Request, t: Timer, out: Outcome): Promise<Response> {
  const done = (r: RoomResult) => {
    out.ok = r.ok;
    out.error = r.ok ? null : r.error;
    return reply(r);
  };
  const failed = (error: RoomError | "unauthorized") => {
    out.error = error;
    return fail(error);
  };

  if (req.method !== "POST") return failed("bad_request");

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const action = typeof body?.["action"] === "string" ? (body["action"] as string) : "?";
  out.action = action;

  const code = body && action !== "create" ? normalizeCode(body["code"]) : null;
  const firstRead = code ? readRoom(code, t) : null;
  firstRead?.catch(() => undefined); 

  // Verify the JWT using the project's asymmetric signing key.
  // getClaims() can avoid a network request to the Auth service.
  const { data: claimsData, error: claimsError } = await t.span(
    "auth",
    () => admin.auth.getClaims(token),
  );

  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string" || !userId) {
    out.error = "unauthorized";
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // Use the verified user ID for room authorization checks.
  const user = { id: userId };

  if (!body) return failed("bad_request");

  try {
    if (action === "create") return done(await createRoom(user.id, body["name"], body["mode"], t, out));

    if (!code || !firstRead) return failed("invalid_code");

    switch (action) {
      case "join":
        return done(await mutate(code, (row) => joinRoom(row, user.id, body["name"]), t, out, firstRead));
      case "move":
        return done(await mutate(code, (row) => makeMove(row, user.id, body["index"]), t, out, firstRead));
      case "rematch":
        return done(await mutate(code, (row) => requestRematch(row, user.id), t, out, firstRead));
      case "leave":
        return done(await mutate(code, (row) => leaveRoom(row, user.id), t, out, firstRead));
      default:
        return failed("bad_request");
    }
  } catch (err) {
    console.error(`[rooms error] id=${t.id}`, err);
    out.error = "server_error";
    return json({ ok: false, error: "server_error" }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const cold = served++ === 0;
  const t = createTimer(crypto.randomUUID().slice(0, 8));
  const out: Outcome = { action: "?", ok: false, error: null, attempts: 0 };

  const res = await handle(req, t, out);

  res.headers.set("Server-Timing", t.serverTiming());
  res.headers.set("x-request-id", t.id);
  res.headers.set("x-rooms-build", BUILD_ID);
  console.log(
    formatTimingLog(t, { id: t.id, ...out, cold, isolateAgeMs: Date.now() - bootedAt, region, build: BUILD_ID }),
  );
  return res;
});
