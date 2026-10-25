import { applyMove, getLegalMoves, MAX_ACTIVE_MARKS, opponentOf, WIN_LINES } from "./engine";
import type { Difficulty, GameState, PlayerSymbol } from "./types";

export type Rng = () => number;

const CORNERS = [0, 2, 6, 8];

function play(state: GameState, move: number): GameState {
  const next = applyMove(state, move);
  if (!next) throw new Error(`Illegal move ${move}`);
  return next;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function bestOf(scored: readonly { move: number; score: number }[], rng: Rng): number {
  const top = Math.max(...scored.map((s) => s.score));
  return pick(
    scored.filter((s) => s.score === top).map((s) => s.move),
    rng,
  );
}

const moveRank = (m: number) => (m === 4 ? 0 : CORNERS.includes(m) ? 1 : 2);
const ordered = (moves: number[]) => moves.sort((a, b) => moveRank(a) - moveRank(b));

/** Picks a legal move for `state.current`. Every move is validated by the shared engine. */
export function chooseMove(state: GameState, difficulty: Difficulty, rng: Rng = Math.random): number {
  const moves = getLegalMoves(state);
  if (moves.length === 0) throw new Error("No legal moves available");
  switch (difficulty) {
    case "easy":
      return pick(moves, rng);
    case "medium":
      return mediumMove(state, moves, rng);
    case "hard":
      return hardMove(state, moves, rng);
    default:
      return pick(moves, rng);
  }
}

/* ------------------------------------------------------------------ */
/* Medium: win now, don't leave the opponent a win, otherwise sensible */
/* ------------------------------------------------------------------ */

function mediumMove(state: GameState, moves: number[], rng: Rng): number {
  const winning = moves.filter((m) => play(state, m).status === "won");
  if (winning.length > 0) return pick(winning, rng);

  // A move is "safe" if the opponent has no winning reply. The reply is simulated with
  // the real rules, so in Modern mode a line that depends on the opponent's soon-to-vanish
  // oldest mark is (correctly) not treated as a threat.
  const safe = moves.filter((m) => {
    const next = play(state, m);
    return !getLegalMoves(next).some((reply) => play(next, reply).status === "won");
  });
  const pool = safe.length > 0 ? safe : moves;

  const preferred = pool.filter((m) => m === 4 || CORNERS.includes(m));
  if (preferred.length > 0 && rng() < 0.7) return pick(preferred, rng);
  return pick(pool, rng);
}

/* ------------------------------------------------------------------ */
/* Hard                                                                */
/* ------------------------------------------------------------------ */

function hardMove(state: GameState, moves: number[], rng: Rng): number {
  if (moves.length === state.board.length) return pick([0, 2, 4, 6, 8], rng); // every good opening is equal
  return state.mode === "classic" ? classicBestMove(state, moves, rng) : modernBestMove(state, moves, rng);
}

/** Classic: exhaustive negamax with alpha-beta. The tree is small, so play is perfect. */
function classicValue(state: GameState, depth: number, alpha: number, beta: number): number {
  let best = -Infinity;
  for (const move of getLegalMoves(state)) {
    const next = play(state, move);
    const value =
      next.status === "won" ? 10 - depth : next.status === "draw" ? 0 : -classicValue(next, depth + 1, -beta, -alpha);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function classicBestMove(state: GameState, moves: number[], rng: Rng): number {
  const scored = moves.map((move) => {
    const next = play(state, move);
    const score =
      next.status === "won" ? 9 : next.status === "draw" ? 0 : -classicValue(next, 2, -Infinity, Infinity);
    return { move, score };
  });
  return bestOf(scored, rng);
}

/**
 * Modern: the game has no natural end (marks vanish, the board never fills), so a
 * full-depth search is impossible. Instead: depth-limited negamax with alpha-beta
 * over the real transition rules (history, oldest-mark removal), preferring faster
 * wins and slower losses, with a heuristic at the horizon that ignores marks about
 * to vanish.
 */
const WIN_SCORE = 10_000;
const LINE_WEIGHT = [0, 3, 20] as const;

/** Marks that will still be on the board after their owner's next move. */
function lastingMarks(state: GameState, symbol: PlayerSymbol): Set<number> {
  const marks = state.marks[symbol];
  return new Set(marks.length >= MAX_ACTIVE_MARKS ? marks.slice(1) : marks);
}

/** Static score for `state.current`, from lines that survive vanishing. */
function evaluate(state: GameState): number {
  const me = state.current;
  const mine = lastingMarks(state, me);
  const theirs = lastingMarks(state, opponentOf(me));
  let score = 0;
  for (const line of WIN_LINES) {
    let m = 0;
    let t = 0;
    for (const i of line) {
      if (mine.has(i)) m++;
      else if (theirs.has(i)) t++;
    }
    if (t === 0) score += LINE_WEIGHT[m] ?? 0;
    else if (m === 0) score -= LINE_WEIGHT[t] ?? 0;
  }
  if (mine.has(4)) score += 3;
  if (theirs.has(4)) score -= 3;
  return score;
}

function modernValue(state: GameState, remaining: number, ply: number, alpha: number, beta: number): number {
  if (remaining === 0) return evaluate(state);
  let best = -Infinity;
  for (const move of ordered(getLegalMoves(state))) {
    const next = play(state, move);
    const value =
      next.status === "won" ? WIN_SCORE - ply : -modernValue(next, remaining - 1, ply + 1, -beta, -alpha);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function modernBestMove(state: GameState, moves: number[], rng: Rng): number {
  const filled = state.board.filter((c) => c !== null).length;
  const depth = filled < 4 ? 6 : 9;
  const scored = moves.map((move) => {
    const next = play(state, move);
    const score =
      next.status === "won" ? WIN_SCORE - 1 : -modernValue(next, depth - 1, 2, -Infinity, Infinity);
    return { move, score };
  });
  return bestOf(scored, rng);
}
