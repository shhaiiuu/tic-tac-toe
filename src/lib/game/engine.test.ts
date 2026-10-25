import { describe, expect, it } from "vitest";
import { applyMove, createGame, getLegalMoves, isValidMove, oldestMarkToVanish, WIN_LINES } from "./engine";
import type { GameMode, GameState } from "./types";

function play(mode: GameMode, moves: number[]): GameState {
  let state = createGame(mode);
  for (const m of moves) {
    const next = applyMove(state, m);
    if (!next) throw new Error(`move ${m} rejected in ${JSON.stringify(moves)}`);
    state = next;
  }
  return state;
}

/** Board cells must agree exactly with each player's mark list. */
function expectConsistent(state: GameState) {
  for (const p of ["X", "O"] as const) {
    const fromBoard = state.board.flatMap((c, i) => (c === p ? [i] : [])).sort();
    expect([...state.marks[p]].sort()).toEqual(fromBoard);
  }
}

describe("Classic rules", () => {
  it.each(WIN_LINES.map((l) => [l.join("-"), l] as const))("X wins on line %s", (_name, line) => {
    const filler = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !line.includes(i));
    const state = play("classic", [line[0], filler[0]!, line[1], filler[1]!, line[2]]);
    expect(state.status).toBe("won");
    expect(state.winner).toBe("X");
    expect(state.winLine).toEqual([...line]);
  });

  it("O can win too", () => {
    const state = play("classic", [0, 3, 1, 4, 8, 5]);
    expect(state.winner).toBe("O");
    expect(state.winLine).toEqual([3, 4, 5]);
  });

  it("detects a draw", () => {
    const state = play("classic", [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(state.status).toBe("draw");
    expect(state.winner).toBeNull();
  });

  it("a winning last move is a win, not a draw", () => {
    const state = play("classic", [0, 1, 2, 3, 7, 5, 4, 6, 8]);
    expect(state.status).toBe("won");
    expect(state.winner).toBe("X");
  });

  it("X goes first and turns alternate", () => {
    const s0 = createGame("classic");
    expect(s0.current).toBe("X");
    expect(applyMove(s0, 4)?.current).toBe("O");
  });

  it("marks stay on the board in classic mode", () => {
    const state = play("classic", [0, 1, 3, 2, 8, 7]);
    expect(state.marks.X).toEqual([0, 3, 8]);
    expect(play("classic", [0, 1, 3, 2, 8, 7, 4]).board[0]).toBe("X");
  });

  it("rejects occupied, out-of-range and non-integer cells", () => {
    const state = play("classic", [4]);
    for (const bad of [4, -1, 9, 1.5, NaN]) {
      expect(isValidMove(state, bad)).toBe(false);
      expect(applyMove(state, bad)).toBeNull();
    }
  });

  it("rejects moves after the round ends and does not mutate state", () => {
    const won = play("classic", [0, 3, 1, 4, 2]);
    expect(getLegalMoves(won)).toEqual([]);
    expect(applyMove(won, 8)).toBeNull();
    const before = createGame("classic");
    applyMove(before, 0);
    expect(before.board.every((c) => c === null)).toBe(true);
    expect(before.history).toHaveLength(0);
  });
});

describe("Modern rules", () => {
  // X: 0,3,8  O: 1,2,7 — six marks, nobody has won
  const sixMarks = [0, 1, 3, 2, 8, 7];

  it("each player can place three marks without anything vanishing", () => {
    const state = play("modern", sixMarks);
    expect(state.marks.X).toEqual([0, 3, 8]);
    expect(state.marks.O).toEqual([1, 2, 7]);
    expect(state.history.every((h) => h.vanished === null)).toBe(true);
    expectConsistent(state);
  });

  it("the fourth move removes only that player's oldest mark", () => {
    const state = play("modern", [...sixMarks, 4]);
    expect(state.board[0]).toBeNull();
    expect(state.board[4]).toBe("X");
    expect(state.marks.X).toEqual([3, 8, 4]);
    expect(state.marks.O).toEqual([1, 2, 7]);
    expect(state.history.at(-1)?.vanished).toBe(0);
    expect(state.status).toBe("playing");
    expectConsistent(state);
  });

  it("each player has an independent history and order stays right over repeated moves", () => {
    const s1 = play("modern", [...sixMarks, 4, 5]); // O's 4th: 1 vanishes
    expect(s1.marks.O).toEqual([2, 7, 5]);
    expect(s1.board[1]).toBeNull();
    expect(s1.marks.X).toEqual([3, 8, 4]);
    const s2 = play("modern", [...sixMarks, 4, 5, 6]); // X's 5th: 3 vanishes
    expect(s2.marks.X).toEqual([8, 4, 6]);
    expect(s2.board[3]).toBeNull();
    expect(s2.marks.O).toEqual([2, 7, 5]);
    expectConsistent(s2);
  });

  it("reports which mark will vanish next", () => {
    expect(oldestMarkToVanish(play("modern", [0, 1, 3, 2]))).toBeNull();
    expect(oldestMarkToVanish(play("modern", [0, 1, 3, 2, 8, 7]))).toBe(0);
    expect(oldestMarkToVanish(play("classic", [0, 1, 3, 2, 8, 7]))).toBeNull();
  });

  it("cannot move onto an occupied cell, including your own oldest mark", () => {
    const state = play("modern", sixMarks);
    expect(applyMove(state, 0)).toBeNull(); // own oldest
    expect(applyMove(state, 1)).toBeNull(); // opponent's
  });

  it("wins using the newer marks after the oldest vanishes", () => {
    const state = play("modern", [0, 1, 3, 2, 4, 7, 5]);
    expect(state.status).toBe("won");
    expect(state.winner).toBe("X");
    expect(state.winLine).toEqual([3, 4, 5]);
    expect(state.board[0]).toBeNull();
    expect(state.marks.O).toEqual([1, 2, 7]);
  });

  it("a line that needed the vanished mark is not a win", () => {
    // X holds 0,1 then places a 4th mark on 2: the 0 disappears first, so 0-1-2 is incomplete.
    const state = play("modern", [0, 3, 1, 4, 8, 7, 2]);
    expect(state.status).toBe("playing");
    expect(state.board[0]).toBeNull();
    expect(state.marks.X).toEqual([1, 8, 2]);
  });

  it("never ends in a draw and never breaks invariants over many random games", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let g = 0; g < 300; g++) {
      let state = createGame("modern");
      for (let ply = 0; ply < 60 && state.status === "playing"; ply++) {
        const moves = getLegalMoves(state);
        state = applyMove(state, moves[Math.floor(rand() * moves.length)]!)!;
        expect(state.marks.X.length).toBeLessThan(4);
        expect(state.marks.O.length).toBeLessThan(4);
        expectConsistent(state);
      }
      expect(state.status).not.toBe("draw");
    }
  });

  it("a new round starts with a clean board and empty histories", () => {
    const fresh = createGame("modern");
    expect(fresh.board.every((c) => c === null)).toBe(true);
    expect(fresh.marks).toEqual({ X: [], O: [] });
    expect(fresh.current).toBe("X");
    expect(fresh.history).toHaveLength(0);
  });
});
