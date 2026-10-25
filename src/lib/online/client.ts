import { isValidMove } from "../game/engine";
import type { GameMode } from "../game/types";
import { errorCode, friendlyError } from "./messages";
import type { RoomAction, RoomRow, Transport } from "./transport";
import { viewRoom } from "./view";

export interface OnlineState {
  readonly userId: string | null;
  readonly room: RoomRow | null;
  /** User ids currently connected to the room channel (includes me once subscribed). */
  readonly presence: readonly string[];
  readonly busy: boolean;
  readonly error: string | null;
}

export const INITIAL_ONLINE_STATE: OnlineState = { userId: null, room: null, presence: [], busy: false, error: null };

const STORAGE_KEY = "tic-tac-toe:online:session";

interface Saved {
  code: string;
  name: string;
}

/**
 * Client-side controller for one player's online session. It never decides game outcomes:
 * every move is sent to the trusted backend, and the board shown always comes from the
 * room row the backend wrote (delivered live over Realtime).
 */
export function createOnlineClient(transport: Transport, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
  let state: OnlineState = INITIAL_ONLINE_STATE;
  const listeners = new Set<() => void>();
  let unwatch: (() => void) | null = null;
  /** False once the screen is gone: a slow request finishing later must not open a channel. */
  let attached = true;

  const set = (patch: Partial<OnlineState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const save = (s: Saved | null) => {
    try {
      if (s) storage?.setItem(STORAGE_KEY, JSON.stringify(s));
      else storage?.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable: resume-after-refresh simply won't work
    }
  };
  const loadSaved = (): Saved | null => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
      return parsed && typeof parsed.code === "string" && typeof parsed.name === "string"
        ? { code: parsed.code, name: parsed.name }
        : null;
    } catch {
      return null;
    }
  };

  /** Ignore rows that are older than what we already show (out-of-order events). */
  const applyRow = (row: RoomRow) => {
    const current = state.room;
    if (current && current.code === row.code && row.version < current.version) return;
    set({ room: row });
  };

  const stopWatching = () => {
    unwatch?.();
    unwatch = null;
    if (state.presence.length) set({ presence: [] });
  };

  const startWatching = (code: string, userId: string) => {
    stopWatching();
    if (!attached) return;
    unwatch = transport.watch(code, userId, {
      onRow: applyRow,
      onPresence: (ids) => set({ presence: ids }),
      onResync: () => {
        void transport
          .fetchRoom(code)
          .then((row) => row && state.room?.code === code && applyRow(row))
          .catch(() => undefined);
      },
    });
  };

  const enter = (room: RoomRow, userId: string, name: string) => {
    set({ room, userId, error: null });
    save({ code: room.code, name });
    startWatching(room.code, userId);
  };

  async function run(action: RoomAction, name = ""): Promise<boolean> {
    if (state.busy) return false;
    attached = true;
    set({ busy: true, error: null });
    try {
      const userId = await transport.getUserId();
      const result = await transport.call(action);
      if (!result.ok) {
        set({ busy: false, userId, error: friendlyError(result.error) });
        return false;
      }
      if (action.action === "create" || action.action === "join") enter(result.room, userId, name);
      else applyRow(result.room);
      set({ busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: friendlyError(errorCode(err)) });
      return false;
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearError: () => state.error && set({ error: null }),

    createRoom: (name: string, mode: GameMode) => run({ action: "create", name, mode }, name),
    joinRoom: (code: string, name: string) => run({ action: "join", code, name }, name),

    /** Tap a cell. Local checks only avoid pointless requests; the backend is the authority. */
    async playMove(index: number): Promise<boolean> {
      const room = state.room;
      const v = room && viewRoom(room, state.userId);
      if (!room || !v) return false;
      if (room.status !== "playing") return false;
      if (!v.myTurn) {
        set({ error: friendlyError("not_your_turn") });
        return false;
      }
      if (!isValidMove(room.game, index)) {
        set({ error: friendlyError("invalid_move") });
        return false;
      }
      return run({ action: "move", code: room.code, index });
    },

    /** Play Again: the next round starts once both players have asked for it. */
    async requestRematch(): Promise<boolean> {
      const room = state.room;
      return room ? run({ action: "rematch", code: room.code }) : false;
    },

    /** Leave the room for good (closes it for the other player too). */
    async leave() {
      const room = state.room;
      stopWatching();
      save(null);
      set({ room: null, error: null, busy: false });
      if (room && room.status !== "abandoned") {
        try {
          await transport.call({ action: "leave", code: room.code });
        } catch {
          // best effort: the other side will see us go offline via presence
        }
      }
    },

    /** Stop listening (e.g. screen unmounted) but keep the room so we can come back to it. */
    disconnect() {
      attached = false;
      stopWatching();
    },

    /** Re-attach to the current room, or rejoin the one saved before a page refresh. */
    async resume(): Promise<void> {
      attached = true;
      if (state.room && state.userId) {
        if (!unwatch) startWatching(state.room.code, state.userId);
        const row = await transport.fetchRoom(state.room.code).catch(() => null);
        if (row) applyRow(row);
        return;
      }
      const saved = loadSaved();
      if (!saved) return;
      const ok = await run({ action: "join", code: saved.code, name: saved.name }, saved.name);
      if (!ok) {
        save(null);
        set({ error: null });
      }
    },
  };
}

export type OnlineClient = ReturnType<typeof createOnlineClient>;
