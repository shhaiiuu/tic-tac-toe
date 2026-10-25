// In-memory stand-in for Supabase, used ONLY by tests. It runs the very same room rules as
// the Edge Function (supabase/functions/_shared/rooms.ts), applies the same version check,
// and only delivers changes to members (like RLS + Realtime). Two OnlineClients talking to
// one FakeBackend behave like two devices in one room.
import {
  buildNewRoom,
  generateCode,
  joinRoom,
  leaveRoom,
  makeMove,
  normalizeCode,
  requestRematch,
  sideOf,
  writableColumns,
  type RoomResult,
  type RoomRow,
} from "../../../supabase/functions/_shared/rooms.ts";
import type { CallResult, RoomAction, Transport, WatchHandlers } from "./transport";

interface Watcher {
  userId: string;
  code: string;
  handlers: WatchHandlers;
}

export class FakeBackend {
  rooms = new Map<string, RoomRow>();
  private watchers = new Set<Watcher>();
  private seq = 0;
  /** Number of times a client tried to write that the backend rejected. */
  rejected = 0;

  transportFor(userId: string): Transport {
    return {
      getUserId: async () => userId,
      call: async (action) => this.handle(userId, action),
      fetchRoom: async (code) => {
        const row = this.rooms.get(code) ?? null;
        return row && sideOf(row, userId) ? row : null; // RLS: members only
      },
      watch: (code, uid, handlers) => {
        const w: Watcher = { userId: uid, code, handlers };
        this.watchers.add(w);
        this.emitPresence(code);
        handlers.onResync();
        return () => {
          this.watchers.delete(w);
          this.emitPresence(code);
        };
      },
    };
  }

  private emitPresence(code: string) {
    const ids = [...new Set([...this.watchers].filter((w) => w.code === code).map((w) => w.userId))];
    this.watchers.forEach((w) => w.code === code && w.handlers.onPresence(ids));
  }

  private commit(row: RoomRow, next: RoomRow): RoomRow {
    if (next === row) return row;
    const saved: RoomRow = { ...next, ...writableColumns(next), version: row.version + 1, updated_at: new Date().toISOString() };
    this.rooms.set(saved.code, saved);
    this.watchers.forEach((w) => {
      if (w.code === saved.code && sideOf(saved, w.userId)) w.handlers.onRow(saved);
    });
    return saved;
  }

  private handle(userId: string, a: RoomAction): CallResult {
    const done = (r: RoomResult): CallResult => {
      if (!r.ok) {
        this.rejected++;
        return { ok: false, error: r.error };
      }
      return { ok: true, room: r.row };
    };

    if (a.action === "create") {
      let code = generateCode(() => Math.floor(Math.random() * 31));
      while (this.rooms.has(code)) code = generateCode(() => Math.floor(Math.random() * 31));
      const base = buildNewRoom(code, userId, a.name, a.mode);
      if (!base) return done({ ok: false, error: "bad_request" });
      const row: RoomRow = { ...base, id: `room-${++this.seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      this.rooms.set(code, row);
      return { ok: true, room: row };
    }

    const code = normalizeCode(a.code);
    if (!code) return done({ ok: false, error: "invalid_code" });
    const row = this.rooms.get(code);
    if (!row) return done({ ok: false, error: "not_found" });

    const result =
      a.action === "join"
        ? joinRoom(row, userId, a.name)
        : a.action === "move"
          ? makeMove(row, userId, a.index)
          : a.action === "rematch"
            ? requestRematch(row, userId)
            : leaveRoom(row, userId);
    if (!result.ok) return done(result);
    return { ok: true, room: this.commit(row, result.row) };
  }
}
