import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfig, DEFAULT_PREFS, describeResult } from "./config";
import {
  cancelPending,
  discardSession,
  getSession,
  playAgain,
  playHumanMove,
  resetRound,
  startGame,
} from "./session";
import { getStats, lineFor, resetStats } from "./stats";

const vsComputer = (over: Partial<typeof DEFAULT_PREFS> = {}) =>
  buildConfig({ ...DEFAULT_PREFS, opponent: "computer", ...over });
const friend = (over: Partial<typeof DEFAULT_PREFS> = {}) =>
  buildConfig({ ...DEFAULT_PREFS, opponent: "friend", ...over });

const filled = () => getSession()!.game.board.filter((c) => c !== null).length;

describe("game session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    discardSession();
    resetStats();
  });
  afterEach(() => {
    discardSession();
    vi.useRealTimers();
  });

  it("computer answers after a delay, and the human is locked out while it thinks", () => {
    startGame(vsComputer({ difficulty: "easy" }));
    expect(playHumanMove(4)).toBe(true);
    expect(getSession()!.thinking).toBe(true);
    expect(playHumanMove(0)).toBe(false); // not your turn
    expect(filled()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(filled()).toBe(2);
    expect(getSession()!.thinking).toBe(false);
    expect(getSession()!.game.current).toBe("X");
  });

  it("computer plays first when the human chooses O", () => {
    startGame(vsComputer({ humanSymbol: "O" }));
    expect(getSession()!.thinking).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(filled()).toBe(1);
    expect(getSession()!.game.current).toBe("O");
  });

  it("resetting during the computer's delay never lets a stale move land", () => {
    startGame(vsComputer());
    playHumanMove(4);
    resetRound();
    vi.advanceTimersByTime(5000);
    expect(filled()).toBe(0);
    expect(getSession()!.thinking).toBe(false);
  });

  it("leaving to the menu cancels the pending move", () => {
    startGame(vsComputer());
    playHumanMove(4);
    discardSession();
    vi.advanceTimersByTime(5000);
    expect(getSession()).toBeNull();
  });

  it("cancelPending drops the move without touching the board", () => {
    startGame(vsComputer());
    playHumanMove(4);
    cancelPending();
    vi.advanceTimersByTime(5000);
    expect(filled()).toBe(1);
    expect(getSession()!.thinking).toBe(false);
  });

  it("two-player: records one win once, rejects further moves, keeps scores", () => {
    startGame(friend({ player1: "Ann", player2: "Ben" }));
    for (const m of [0, 3, 1, 4, 2]) expect(playHumanMove(m)).toBe(true);
    const s = getSession()!;
    expect(s.result?.winner).toBe("X");
    expect(s.scores.X).toBe(1);
    expect(describeResult(s.config, "X").title).toBe("Ann Wins!");
    expect(playHumanMove(8)).toBe(false);
    expect(lineFor(getStats(), "classic", "friend")).toEqual({ a: 1, b: 0, draws: 0 });
    vi.advanceTimersByTime(5000);
    expect(lineFor(getStats(), "classic", "friend")).toEqual({ a: 1, b: 0, draws: 0 });
  });

  it("play again starts a clean round and keeps mode, opponent and session scores", () => {
    startGame(friend({ mode: "modern" }));
    for (const m of [0, 3, 1, 4, 2]) playHumanMove(m);
    playAgain();
    const s = getSession()!;
    expect(s.game.mode).toBe("modern");
    expect(s.config.opponent).toBe("friend");
    expect(s.game.board.every((c) => c === null)).toBe(true);
    expect(s.game.marks).toEqual({ X: [], O: [] });
    expect(s.game.current).toBe("X");
    expect(s.result).toBeNull();
    expect(s.scores.X).toBe(1);
    expect(s.round).toBe(2);
  });

  it("draws are counted in classic two-player stats", () => {
    startGame(friend());
    for (const m of [0, 1, 2, 4, 3, 5, 7, 6, 8]) playHumanMove(m);
    expect(getSession()!.result?.winner).toBeNull();
    expect(lineFor(getStats(), "classic", "friend").draws).toBe(1);
    expect(describeResult(getSession()!.config, null).title).toBe("It's a Draw!");
  });

  it("stats vs computer count the human's results and are separate per mode", () => {
    startGame(vsComputer({ humanSymbol: "X", difficulty: "hard", mode: "classic" }));
    // Human plays badly until the hard computer wins.
    for (let i = 0; i < 6 && getSession()!.game.status === "playing"; i++) {
      const empty = getSession()!.game.board.findIndex((c) => c === null);
      playHumanMove(empty);
      vi.advanceTimersByTime(2000);
    }
    const s = getSession()!;
    expect(s.result?.winner).toBe("O");
    expect(describeResult(s.config, "O").title).toBe("Computer Wins!");
    expect(lineFor(getStats(), "classic", "computer")).toEqual({ a: 0, b: 1, draws: 0 });
    expect(lineFor(getStats(), "modern", "computer")).toEqual({ a: 0, b: 0, draws: 0 });
  });
});
