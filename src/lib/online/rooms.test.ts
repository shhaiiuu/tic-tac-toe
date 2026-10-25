import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildNewRoom,
  CODE_ALPHABET,
  generateCode,
  joinRoom,
  leaveRoom,
  makeMove,
  normalizeCode,
  requestRematch,
  sanitizeName,
  type RoomResult,
  type RoomRow,
} from "../../../supabase/functions/_shared/rooms.ts";
import type { GameMode } from "../game/types";

const HOST = "host-user";
const GUEST = "guest-user";
const STRANGER = "stranger";

function newRoom(mode: GameMode = "classic"): RoomRow {
  const base = buildNewRoom("ABCDE", HOST, "Ann", mode)!;
  return { ...base, id: "r1", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}
const must = (r: RoomResult): RoomRow => {
  if (!r.ok) throw new Error(`unexpected error ${r.error}`);
  return r.row;
};
const joined = (mode: GameMode = "classic") => must(joinRoom(newRoom(mode), GUEST, "Ben"));

/** Alternate host (X) / guest (O) through a list of cells. */
function playCells(row: RoomRow, cells: number[]): RoomRow {
  let r = row;
  for (const c of cells) {
    const who = r.game.current === r.host_symbol ? HOST : GUEST;
    r = must(makeMove(r, who, c));
  }
  return r;
}

describe("room codes and names", () => {
  it("normalizes valid codes and rejects invalid ones", () => {
    expect(normalizeCode("abcde")).toBe("ABCDE");
    expect(normalizeCode(" ab-cde ")).toBe("ABCDE");
    for (const bad of ["ABCD", "ABCDEF", "ABCD0", "ABCDO", "AB!DE", "", 12345, null, undefined]) {
      expect(normalizeCode(bad)).toBeNull();
    }
  });

  it("generates codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode((max) => Math.floor(Math.random() * max));
      expect(code).toHaveLength(5);
      expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it("sanitizes names", () => {
    expect(sanitizeName("  Sam   Lee  ", "P")).toBe("Sam Lee");
    expect(sanitizeName("x".repeat(40), "P")).toHaveLength(16);
    expect(sanitizeName("   ", "P")).toBe("P");
    expect(sanitizeName(42, "P")).toBe("P");
    expect(sanitizeName("a\u0000b", "P")).toBe("ab");
  });
});

describe("joining", () => {
  it("a new room waits for a guest, host plays X", () => {
    const room = newRoom();
    expect(room.status).toBe("waiting");
    expect(room.host_symbol).toBe("X");
  });

  it("the first guest joins and the match starts", () => {
    const room = joined();
    expect(room.status).toBe("playing");
    expect(room.guest_id).toBe(GUEST);
    expect(room.guest_name).toBe("Ben");
  });

  it("a third person gets room_full", () => {
    const r = joinRoom(joined(), STRANGER, "Eve");
    expect(r).toEqual({ ok: false, error: "room_full" });
  });

  it("members can rejoin (refresh) and get the same room back", () => {
    const room = joined();
    expect(must(joinRoom(room, GUEST, "Ben"))).toBe(room);
    expect(must(joinRoom(room, HOST, "Ann"))).toBe(room);
  });

  it("closed and expired rooms cannot be joined", () => {
    const closed = must(leaveRoom(newRoom(), HOST));
    expect(joinRoom(closed, GUEST, "Ben")).toEqual({ ok: false, error: "room_closed" });
    const old = { ...newRoom(), created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() };
    expect(joinRoom(old, GUEST, "Ben")).toEqual({ ok: false, error: "expired" });
  });

  it("gives a joiner with the same name a distinct one", () => {
    expect(must(joinRoom(newRoom(), GUEST, "ann")).guest_name).toBe("ann 2");
  });
});

describe("move validation (server side)", () => {
  it("rejects moves before the guest has joined", () => {
    expect(makeMove(newRoom(), HOST, 4)).toEqual({ ok: false, error: "not_playing" });
  });

  it("only members may move", () => {
    expect(makeMove(joined(), STRANGER, 4)).toEqual({ ok: false, error: "not_member" });
  });

  it("enforces turns: host (X) first, then guest (O)", () => {
    const room = joined();
    expect(makeMove(room, GUEST, 4)).toEqual({ ok: false, error: "not_your_turn" });
    const after = must(makeMove(room, HOST, 4));
    expect(makeMove(after, HOST, 0)).toEqual({ ok: false, error: "not_your_turn" });
    expect(must(makeMove(after, GUEST, 0)).game.board[0]).toBe("O");
  });

  it("rejects occupied, out-of-range and non-numeric cells", () => {
    const room = must(makeMove(joined(), HOST, 4));
    expect(makeMove(room, GUEST, 4)).toEqual({ ok: false, error: "invalid_move" });
    expect(makeMove(room, GUEST, 9)).toEqual({ ok: false, error: "invalid_move" });
    expect(makeMove(room, GUEST, -1)).toEqual({ ok: false, error: "invalid_move" });
    expect(makeMove(room, GUEST, "4")).toEqual({ ok: false, error: "bad_request" });
  });

  it("does not mutate the previous row", () => {
    const room = joined();
    must(makeMove(room, HOST, 4));
    expect(room.game.board[4]).toBeNull();
  });
});

describe("classic online rounds", () => {
  it("host wins on the top row; scores update; no moves afterwards", () => {
    const row = playCells(joined(), [0, 3, 1, 4, 2]);
    expect(row.status).toBe("finished");
    expect(row.game.winner).toBe("X");
    expect(row.game.winLine).toEqual([0, 1, 2]);
    expect(row.scores).toEqual({ host: 1, guest: 0, draws: 0 });
    expect(makeMove(row, GUEST, 8)).toEqual({ ok: false, error: "not_playing" });
  });

  it("guest can win too", () => {
    const row = playCells(joined(), [0, 3, 1, 4, 8, 5]);
    expect(row.game.winner).toBe("O");
    expect(row.scores).toEqual({ host: 0, guest: 1, draws: 0 });
  });

  it("detects a draw", () => {
    const row = playCells(joined(), [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(row.status).toBe("finished");
    expect(row.game.status).toBe("draw");
    expect(row.scores).toEqual({ host: 0, guest: 0, draws: 1 });
  });
});

describe("modern online rounds", () => {
  it("a player's fourth mark removes only their own oldest mark", () => {
    const row = playCells(joined("modern"), [0, 1, 3, 2, 8, 7, 4]);
    expect(row.game.board[0]).toBeNull();
    expect(row.game.marks.X).toEqual([3, 8, 4]);
    expect(row.game.marks.O).toEqual([1, 2, 7]);
    expect(row.status).toBe("playing");
  });

  it("wins after the vanish, and never draws", () => {
    const row = playCells(joined("modern"), [0, 1, 3, 2, 4, 7, 5]);
    expect(row.status).toBe("finished");
    expect(row.game.winLine).toEqual([3, 4, 5]);
    expect(row.scores.host).toBe(1);
  });
});

describe("rematch", () => {
  const finished = () => playCells(joined(), [0, 3, 1, 4, 2]);

  it("only after a round has finished", () => {
    expect(requestRematch(joined(), HOST)).toEqual({ ok: false, error: "not_playing" });
    expect(requestRematch(finished(), STRANGER)).toEqual({ ok: false, error: "not_member" });
  });

  it("waits for both players, then starts a clean round with swapped symbols", () => {
    const one = must(requestRematch(finished(), HOST));
    expect(one.status).toBe("finished");
    expect(one.host_ready).toBe(true);
    const two = must(requestRematch(one, GUEST));
    expect(two.status).toBe("playing");
    expect(two.round).toBe(2);
    expect(two.host_symbol).toBe("O");
    expect(two.game.board.every((c) => c === null)).toBe(true);
    expect(two.game.marks).toEqual({ X: [], O: [] });
    expect(two.scores.host).toBe(1);
    expect(two.host_ready || two.guest_ready).toBe(false);
    // Guest is X now and moves first.
    expect(makeMove(two, HOST, 4)).toEqual({ ok: false, error: "not_your_turn" });
    expect(must(makeMove(two, GUEST, 4)).game.board[4]).toBe("X");
  });

  it("a double click by the same player does not start the round", () => {
    const one = must(requestRematch(finished(), HOST));
    expect(must(requestRematch(one, HOST)).status).toBe("finished");
  });
});

describe("leaving", () => {
  it("closes the room and records who left", () => {
    const row = must(leaveRoom(joined(), GUEST));
    expect(row.status).toBe("abandoned");
    expect(row.left_by).toBe("guest");
    expect(makeMove(row, HOST, 4)).toEqual({ ok: false, error: "room_closed" });
    expect(requestRematch(row, HOST)).toEqual({ ok: false, error: "room_closed" });
  });

  it("strangers cannot close someone else's room", () => {
    expect(leaveRoom(joined(), STRANGER)).toEqual({ ok: false, error: "not_member" });
  });
});

describe("engine copy used by the Edge Function", () => {
  it.each(["types.ts", "engine.ts"])("%s is identical to src/lib/game (run `bun run sync:engine`)", (file) => {
    const src = readFileSync(`src/lib/game/${file}`, "utf8");
    const copy = readFileSync(`supabase/functions/_shared/game/${file}`, "utf8");
    expect(copy === src).toBe(true);
  });
});
