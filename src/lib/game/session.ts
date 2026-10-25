import { chooseMove } from "./ai";
import { applyMove, createGame } from "./engine";
import { recordOutcome } from "./stats";
import type { GameConfig, GameState, PlayerSymbol } from "./types";

export interface Scores {
  readonly X: number;
  readonly O: number;
  readonly draws: number;
}
export interface RoundResult {
  /** null = draw */
  readonly winner: PlayerSymbol | null;
}
export interface Session {
  readonly config: GameConfig;
  readonly game: GameState;
  readonly thinking: boolean;
  readonly scores: Scores;
  readonly round: number;
  readonly result: RoundResult | null;
}

/** Natural pause before the computer moves. */
export const computerDelay = () => 550 + Math.random() * 350;

let session: Session | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Bumped whenever pending computer work must be invalidated. */
let token = 0;
const listeners = new Set<() => void>();

function set(next: Session | null) {
  session = next;
  listeners.forEach((l) => l());
}

export const getSession = () => session;

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export const isComputerTurn = (s: Session) =>
  s.config.opponent === "computer" && s.game.status === "playing" && s.game.current !== s.config.humanSymbol;

/**
 * (Re)schedules the computer's move if, and only if, it is the computer's turn in
 * an unfinished round. Safe to call any time: it always invalidates older timers first.
 */
export function resumeComputer() {
  clearTimer();
  const mine = ++token;
  const s = session;
  if (!s) return;
  if (!isComputerTurn(s)) {
    if (s.thinking) set({ ...s, thinking: false });
    return;
  }
  if (!s.thinking) set({ ...s, thinking: true });
  timer = setTimeout(() => {
    timer = null;
    if (mine !== token) return; // reset / menu / new game happened meanwhile
    const cur = session;
    if (!cur || !isComputerTurn(cur)) return;
    commit(chooseMove(cur.game, cur.config.difficulty));
  }, computerDelay());
}

/** The only place a move is applied and a round can finish (so a result is recorded once). */
function commit(index: number): boolean {
  const s = session;
  if (!s) return false;
  const next = applyMove(s.game, index);
  if (!next) return false;

  let scores = s.scores;
  let result = s.result;
  if (next.status !== "playing") {
    const { mode, opponent, humanSymbol } = s.config;
    result = { winner: next.winner };
    scores =
      next.winner === null
        ? { ...scores, draws: scores.draws + 1 }
        : { ...scores, [next.winner]: scores[next.winner] + 1 };
    if (next.winner === null) recordOutcome(mode, opponent, "draw");
    else if (opponent === "computer") recordOutcome(mode, opponent, next.winner === humanSymbol ? "a" : "b");
    else recordOutcome(mode, opponent, next.winner === "X" ? "a" : "b");
  }
  set({ ...s, game: next, thinking: false, scores, result });
  resumeComputer();
  return true;
}

export function startGame(config: GameConfig) {
  clearTimer();
  token++;
  set({
    config,
    game: createGame(config.mode),
    thinking: false,
    scores: { X: 0, O: 0, draws: 0 },
    round: 1,
    result: null,
  });
  resumeComputer();
}

/** Fresh round with the same mode / opponent / difficulty / names. Also used for Play Again. */
export function resetRound() {
  const s = session;
  if (!s) return;
  clearTimer();
  token++;
  set({ ...s, game: createGame(s.config.mode), thinking: false, result: null, round: s.round + 1 });
  resumeComputer();
}
export const playAgain = resetRound;

/** A human (or local second player) taps a cell. Returns whether the move was applied. */
export function playHumanMove(index: number): boolean {
  const s = session;
  if (!s || s.game.status !== "playing" || isComputerTurn(s)) return false;
  return commit(index);
}

/** Drop any pending computer move without touching the board. */
export function cancelPending() {
  clearTimer();
  token++;
  if (session?.thinking) set({ ...session, thinking: false });
}

/** Leave the game entirely (back to menu). */
export function discardSession() {
  clearTimer();
  token++;
  if (session) set(null);
}
