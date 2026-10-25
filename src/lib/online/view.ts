import { opponentOf } from "../game/engine";
import type { PlayerSymbol } from "../game/types";
import { sideOf, symbolOf, type Side } from "../../../supabase/functions/_shared/rooms.ts";
import type { RoomRow } from "./transport";

export interface RoomView {
  side: Side;
  mySymbol: PlayerSymbol;
  oppSymbol: PlayerSymbol;
  myName: string;
  oppName: string;
  oppId: string | null;
  myTurn: boolean;
  /** Which of the two players clicked Play Again already. */
  iAmReady: boolean;
  oppReady: boolean;
}

/** The room from one player's point of view, or null if they aren't a member. */
export function viewRoom(room: RoomRow, userId: string | null): RoomView | null {
  if (!userId) return null;
  const side = sideOf(room, userId);
  if (!side) return null;
  const mySymbol = symbolOf(room, side);
  const host = side === "host";
  return {
    side,
    mySymbol,
    oppSymbol: opponentOf(mySymbol),
    myName: host ? room.host_name : (room.guest_name ?? "Player 2"),
    oppName: host ? (room.guest_name ?? "Player 2") : room.host_name,
    oppId: host ? room.guest_id : room.host_id,
    myTurn: room.status === "playing" && room.game.current === mySymbol,
    iAmReady: host ? room.host_ready : room.guest_ready,
    oppReady: host ? room.guest_ready : room.host_ready,
  };
}

export type OnlineTone = "win" | "lose" | "draw";

/** Result-screen copy for a finished online round. */
export function describeOnlineResult(room: RoomRow, v: RoomView) {
  const winner = room.game.winner;
  if (winner === null) {
    return { tone: "draw" as OnlineTone, title: "It's a Draw!", message: "Evenly matched — nobody gets three in a row." };
  }
  return winner === v.mySymbol
    ? { tone: "win" as OnlineTone, title: "You Win!", message: `Nicely played — you beat ${v.oppName}.` }
    : { tone: "lose" as OnlineTone, title: `${v.oppName} Wins!`, message: "Not this time. Ready for a rematch?" };
}
