import type { GameMode } from "../game/types";
import type { RoomRow } from "../../../supabase/functions/_shared/rooms.ts";

export type { RoomRow };

export type RoomAction =
  | { action: "create"; name: string; mode: GameMode }
  | { action: "join"; code: string; name: string }
  | { action: "move"; code: string; index: number }
  | { action: "rematch"; code: string }
  | { action: "leave"; code: string };

export type CallResult = { ok: true; room: RoomRow } | { ok: false; error: string };

export interface WatchHandlers {
  onRow(row: RoomRow): void;
  /** User ids currently connected to the room channel. */
  onPresence(userIds: string[]): void;
  /** The live connection was (re)established: refetch the room to catch anything missed. */
  onResync(): void;
}

/** Everything the client needs from a backend. The real one is Supabase. */
export interface Transport {
  getUserId(): Promise<string>;
  call(action: RoomAction): Promise<CallResult>;
  fetchRoom(code: string): Promise<RoomRow | null>;
  watch(code: string, userId: string, handlers: WatchHandlers): () => void;
}
