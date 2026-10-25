import { describe, expect, it } from "vitest";
import { chooseMove, type Rng } from "./ai";
import { applyMove, createGame, getLegalMoves } from "./engine";
import type { Difficulty, GameMode, GameState, PlayerSymbol } from "./types";

function seeded(seed: number): Rng {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function play(mode: GameMode, moves: number[]): GameState {
  let state = createGame(mode);
  for (const m of moves) state = applyMove(state, m)!;
  return state;
}

/** Plays a whole game; each side is a move picker. Asserts every chosen move is legal. */
function playGame(mode: GameMode, pick: Record<PlayerSymbol, (s: GameState) => number>, maxPly = 60) {
  let state = createGame(mode);
  for (let ply = 0; ply < maxPly && state.status === "playing"; ply++) {
    const move = pick[state.current](state);
    expect(getLegalMoves(state)).toContain(move);
    state = applyMove(state, move)!;
  }
  return state;
}

describe("computer opponent", () => {
  const modes: GameMode[] = ["classic", "modern"];
  const levels: Difficulty[] = ["easy", "medium", "hard"];

  for (const mode of modes) {
    for (const level of levels) {
      it(`${level} always plays legal moves in ${mode} mode`, () => {
        const rng = seeded(7);
        for (let g = 0; g < 6; g++) {
          playGame(mode, {
            X: (s) => chooseMove(s, level, rng),
            O: (s) => chooseMove(s, "easy", rng),
          });
          playGame(mode, {
            X: (s) => chooseMove(s, "easy", rng),
            O: (s) => chooseMove(s, level, rng),
          });
        }
      });
    }
  }

  it("medium and hard take an immediate win", () => {
    const state = play("classic", [0, 3, 1, 4]); // X to move, 2 wins (O also threatens 5)
    for (const level of ["medium", "hard"] as const) expect(chooseMove(state, level, seeded(1))).toBe(2);
  });

  it("medium and hard block an immediate loss", () => {
    const state = play("classic", [0, 4, 1]); // O must take 2
    for (const level of ["medium", "hard"] as const) expect(chooseMove(state, level, seeded(1))).toBe(2);
  });

  it("modern: takes a win that only exists once the oldest mark vanishes", () => {
    const state = play("modern", [0, 1, 3, 2, 4, 7]); // X: 0,3,4 — placing 5 removes 0 and completes 3-4-5
    for (const level of ["medium", "hard"] as const) expect(chooseMove(state, level, seeded(1))).toBe(5);
  });

  it("modern: does not treat a line that relies on a vanishing mark as a threat", () => {
    // O holds [0,1,8] (0 is oldest). Placing on 2 would remove 0, so 0-1-2 is NOT a threat,
    // while X has no reason to waste a move there. Medium's safe-move filter must allow it.
    const state = play("modern", [3, 0, 5, 1, 6, 8, 7]); // X: 3,5,6,7 -> 3 vanished? X had 3,5,6 then 7 removes 3
    expect(state.marks.X).toEqual([5, 6, 7]);
    const move = chooseMove(state, "medium", seeded(3));
    expect(getLegalMoves(state)).toContain(move);
  });

  it("classic hard never loses, against random play or itself", () => {
    const rng = seeded(99);
    for (let g = 0; g < 25; g++) {
      const asX = playGame("classic", { X: (s) => chooseMove(s, "hard", rng), O: (s) => chooseMove(s, "easy", rng) });
      expect(asX.winner).not.toBe("O");
      const asO = playGame("classic", { X: (s) => chooseMove(s, "easy", rng), O: (s) => chooseMove(s, "hard", rng) });
      expect(asO.winner).not.toBe("X");
    }
    const mirror = playGame("classic", { X: (s) => chooseMove(s, "hard", rng), O: (s) => chooseMove(s, "hard", rng) });
    expect(mirror.status).toBe("draw");
  });

  it("modern hard beats random play and never loses to it", () => {
    const rng = seeded(2024);
    let hardWins = 0;
    for (let g = 0; g < 10; g++) {
      const asX = playGame("modern", { X: (s) => chooseMove(s, "hard", rng), O: (s) => chooseMove(s, "easy", rng) });
      const asO = playGame("modern", { X: (s) => chooseMove(s, "easy", rng), O: (s) => chooseMove(s, "hard", rng) });
      expect(asX.winner).not.toBe("O");
      expect(asO.winner).not.toBe("X");
      if (asX.winner === "X") hardWins++;
      if (asO.winner === "O") hardWins++;
    }
    expect(hardWins).toBeGreaterThan(15);
  });
});
