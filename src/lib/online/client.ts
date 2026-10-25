import { applyMove, isValidMove } from "../game/engine";
import type { GameMode, GameState } from "../game/types";
import { errorCode, friendlyError } from "./messages";
import type { RoomAction, RoomRow, Transport } from "./transport";
import { viewRoom } from "./view";

export interface OnlineState {
  readonly userId: string | null;
  readonly room: RoomRow | null;
  /** Temporary local board shown while the server validates a move. */
  readonly optimisticGame: GameState | null;
  /** User ids currently connected to the room channel (includes me once subscribed). */
  readonly presence: readonly string[];
  readonly busy: boolean;
  readonly error: string | null;
}

export const INITIAL_ONLINE_STATE: OnlineState = {
  userId: null,
  room: null,
  optimisticGame: null,
  presence: [],
  busy: false,
  error: null,
};

const STORAGE_KEY = "tic-tac-toe:online:session";

interface Saved {
  code: string;
  name: string;
}

/**
 * Client-side controller for one player's online session. The server remains authoritative;
 * optimisticGame is only a temporary visual preview while a move is being confirmed.
 */
export function createOnlineClient(transport: Transport, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
  let state: OnlineState = INITIAL_ONLINE_STATE;
  const listeners = new Set<() => void>();
  let unwatch: (() => void) | null = null;
  let attached = true;
  let pendingMove: { code: string; baseVersion: number } | null = null;

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

  /** Ignore older rows and clear a preview once a newer server version arrives. */
  const applyRow = (row: RoomRow) => {
    const current = state.room;
    if (current && current.code === row.code && row.version < current.version) return;
    const pending = pendingMove;
    if (pending && pending.code === row.code && row.version > pending.baseVersion) {
      pendingMove = null;
      set({ room: row, optimisticGame: null });
      return;
    }
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
        void transport.fetchRoom(code)
          .then((row) => row && state.room?.code === code && applyRow(row))
          .catch(() => undefined);
      },
    });
  };

  const enter = (room: RoomRow, userId: string, name: string) => {
    pendingMove = null;
    set({ room, userId, error: null, optimisticGame: null });
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
        pendingMove = null;
        set({ busy: false, userId, error: friendlyError(result.error), optimisticGame: null });
        return false;
      }
      if (action.action === "create" || action.action === "join") {
        enter(result.room, userId, name);
      } else if (action.action === "move") {
        pendingMove = null;
        set({ optimisticGame: null });
        applyRow(result.room);
      } else {
        applyRow(result.room);
      }
      set({ busy: false });
      return true;
    } catch (err) {
      pendingMove = null;
      set({ busy: false, error: friendlyError(errorCode(err)), optimisticGame: null });
      return false;
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clearError: () => state.error && set({ error: null }),

    createRoom: (name: string, mode: GameMode) => run({ action: "create", name, mode }, name),
    joinRoom: (code: string, name: string) => run({ action: "join", code, name }, name),

    /** Preview a legal move immediately, then replace it with the server-confirmed room. */
    async playMove(index: number): Promise<boolean> {
      const room = state.room;
      const v = room && viewRoom(room, state.userId);
      if (!room || !v || state.busy || state.optimisticGame) return false;
      if (room.status !== "playing") return false;
      if (!v.myTurn) {
        set({ error: friendlyError("not_your_turn") });
        return false;
      }
      if (!isValidMove(room.game, index)) {
        set({ error: friendlyError("invalid_move") });
        return false;
      }
      const preview = applyMove(room.game, index);
      if (!preview) return false;
      pendingMove = { code: room.code, baseVersion: room.version };
      set({ optimisticGame: preview, error: null });
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
      pendingMove = null;
      stopWatching();
      save(null);
      set({ room: null, optimisticGame: null, error: null, busy: false });
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
