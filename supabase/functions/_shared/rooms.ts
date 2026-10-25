// Pure room rules shared by the Edge Function and the tests. No Deno / Supabase APIs here,
// so every rule can be unit-tested. Moves are validated with the SAME engine the client uses.
import { applyMove, createGame, opponentOf } from "./game/engine.ts";
import type { GameMode, GameState, PlayerSymbol } from "./game/types.ts";

export type Side = "host" | "guest";
export type RoomStatus = "waiting" | "playing" | "finished" | "abandoned";

export interface RoomScores {
  host: number;
  guest: number;
  draws: number;
}

export interface RoomRow {
  id: string;
  code: string;
  mode: GameMode;
  status: RoomStatus;
  host_id: string;
  guest_id: string | null;
  host_name: string;
  guest_name: string | null;
  host_symbol: PlayerSymbol;
  game: GameState;
  round: number;
  scores: RoomScores;
  host_ready: boolean;
  guest_ready: boolean;
  left_by: Side | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type RoomError =
  | "bad_request"
  | "invalid_code"
  | "not_found"
  | "room_full"
  | "expired"
  | "room_closed"
  | "not_member"
  | "not_playing"
  | "not_your_turn"
  | "invalid_move"
  | "conflict";

export type RoomResult = { ok: true; row: RoomRow } | { ok: false; error: RoomError };

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 16;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export function generateCode(randomInt: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Uppercases and strips spaces/dashes. Returns null if it can't be a valid room code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || fallback;
}

export const isMode = (v: unknown): v is GameMode => v === "classic" || v === "modern";

export function sideOf(row: RoomRow, userId: string): Side | null {
  if (row.host_id === userId) return "host";
  if (row.guest_id === userId) return "guest";
  return null;
}

export const symbolOf = (row: RoomRow, side: Side): PlayerSymbol =>
  side === "host" ? row.host_symbol : opponentOf(row.host_symbol);

export type NewRoom = Omit<RoomRow, "id" | "created_at" | "updated_at">;

export function buildNewRoom(code: string, userId: string, name: unknown, mode: unknown): NewRoom | null {
  if (!isMode(mode)) return null;
  return {
    code,
    mode,
    status: "waiting",
    host_id: userId,
    guest_id: null,
    host_name: sanitizeName(name, "Player 1"),
    guest_name: null,
    host_symbol: "X",
    game: createGame(mode),
    round: 1,
    scores: { host: 0, guest: 0, draws: 0 },
    host_ready: false,
    guest_ready: false,
    left_by: null,
    version: 0,
  };
}

/** Columns the Edge Function is allowed to write on an existing room. */
export function writableColumns(row: RoomRow) {
  return {
    status: row.status,
    guest_id: row.guest_id,
    guest_name: row.guest_name,
    host_symbol: row.host_symbol,
    game: row.game,
    round: row.round,
    scores: row.scores,
    host_ready: row.host_ready,
    guest_ready: row.guest_ready,
    left_by: row.left_by,
  };
}

const fail = (error: RoomError): RoomResult => ({ ok: false, error });
const ok = (row: RoomRow): RoomResult => ({ ok: true, row });

/**
 * Join a room. Members calling join again (page refresh, reconnect) get their room back
 * unchanged. A third person gets "room_full".
 */
export function joinRoom(row: RoomRow, userId: string, name: unknown, now = Date.now()): RoomResult {
  if (sideOf(row, userId)) return row.status === "abandoned" ? fail("room_closed") : ok(row);
  if (row.status === "abandoned") return fail("room_closed");
  if (now - Date.parse(row.created_at) > ROOM_TTL_MS) return fail("expired");
  if (row.guest_id !== null || row.status !== "waiting") return fail("room_full");

  let guestName = sanitizeName(name, "Player 2");
  if (guestName.toLowerCase() === row.host_name.toLowerCase()) guestName = `${guestName} 2`.slice(0, MAX_NAME_LENGTH + 2);
  return ok({ ...row, guest_id: userId, guest_name: guestName, status: "playing" });
}

/** Validate and apply one move for `userId` using the shared game engine. */
export function makeMove(row: RoomRow, userId: string, index: unknown): RoomResult {
  const side = sideOf(row, userId);
  if (!side) return fail("not_member");
  if (row.status === "abandoned") return fail("room_closed");
  if (row.status !== "playing") return fail("not_playing");
  if (typeof index !== "number") return fail("bad_request");
  if (row.game.current !== symbolOf(row, side)) return fail("not_your_turn");

  const next = applyMove(row.game, index);
  if (!next) return fail("invalid_move");
  if (next.status === "playing") return ok({ ...row, game: next });

  const scores = { ...row.scores };
  if (next.winner === null) scores.draws += 1;
  else scores[next.winner === row.host_symbol ? "host" : "guest"] += 1;
  return ok({ ...row, game: next, status: "finished", scores, host_ready: false, guest_ready: false });
}

/** Play Again: a new round starts once BOTH players ask for it. Symbols swap each round. */
export function requestRematch(row: RoomRow, userId: string): RoomResult {
  const side = sideOf(row, userId);
  if (!side) return fail("not_member");
  if (row.status === "abandoned") return fail("room_closed");
  if (row.status !== "finished") return fail("not_playing");

  const host_ready = row.host_ready || side === "host";
  const guest_ready = row.guest_ready || side === "guest";
  if (!(host_ready && guest_ready)) return ok({ ...row, host_ready, guest_ready });
  return ok({
    ...row,
    status: "playing",
    round: row.round + 1,
    host_symbol: opponentOf(row.host_symbol),
    game: createGame(row.mode),
    host_ready: false,
    guest_ready: false,
  });
}

/** Leaving closes the room for everyone; the other player is told who left. */
export function leaveRoom(row: RoomRow, userId: string): RoomResult {
  const side = sideOf(row, userId);
  if (!side) return fail("not_member");
  if (row.status === "abandoned") return ok(row);
  return ok({ ...row, status: "abandoned", left_by: side });
}
