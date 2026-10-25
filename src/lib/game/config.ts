import type { Difficulty, GameConfig, GameMode, OpponentType, PlayerSymbol } from "./types";

/** What the setup UI edits. Turned into a GameConfig when a game starts. */
export interface Prefs {
  mode: GameMode;
  opponent: OpponentType;
  difficulty: Difficulty;
  humanSymbol: PlayerSymbol;
  player1: string;
  player2: string;
}

export const DEFAULT_PREFS: Prefs = {
  mode: "classic",
  opponent: "computer",
  difficulty: "medium",
  humanSymbol: "X",
  player1: "",
  player2: "",
};

export const MODE_INFO: Record<GameMode, { title: string; short: string; long: string }> = {
  classic: {
    title: "Classic",
    short: "Marks stay put. Three in a row wins.",
    long: "Traditional rules",
  },
  modern: {
    title: "Modern",
    short: "Only 3 marks each — your oldest vanishes.",
    long: "Vanishing marks",
  },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

const PREFS_KEY = "tic-tac-toe:prefs:v1";
export const MAX_NAME_LENGTH = 16;

export const cleanName = (value: string, fallback: string) =>
  value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) || fallback;

export function buildConfig(prefs: Prefs): GameConfig {
  const names: Record<PlayerSymbol, string> =
    prefs.opponent === "computer"
      ? prefs.humanSymbol === "X"
        ? { X: "You", O: "Computer" }
        : { X: "Computer", O: "You" }
      : { X: cleanName(prefs.player1, "Player 1"), O: cleanName(prefs.player2, "Player 2") };
  return {
    mode: prefs.mode,
    opponent: prefs.opponent,
    difficulty: prefs.difficulty,
    humanSymbol: prefs.opponent === "computer" ? prefs.humanSymbol : "X",
    names,
  };
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
    return {
      mode: oneOf(p.mode, ["classic", "modern"], DEFAULT_PREFS.mode),
      opponent: oneOf(p.opponent, ["computer", "friend"], DEFAULT_PREFS.opponent),
      difficulty: oneOf(p.difficulty, ["easy", "medium", "hard"], DEFAULT_PREFS.difficulty),
      humanSymbol: oneOf(p.humanSymbol, ["X", "O"], DEFAULT_PREFS.humanSymbol),
      player1: typeof p.player1 === "string" ? p.player1.slice(0, MAX_NAME_LENGTH) : "",
      player2: typeof p.player2 === "string" ? p.player2.slice(0, MAX_NAME_LENGTH) : "",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export type ResultTone = "win" | "lose" | "draw";

/** Result-screen copy for a finished round. `winner` is null for a draw. */
export function describeResult(config: GameConfig, winner: PlayerSymbol | null) {
  if (winner === null) {
    return { tone: "draw" as ResultTone, title: "It's a Draw!", message: "Evenly matched — nobody gets three in a row." };
  }
  if (config.opponent === "computer") {
    return winner === config.humanSymbol
      ? { tone: "win" as ResultTone, title: "You Win!", message: "Nicely played — three in a row." }
      : { tone: "lose" as ResultTone, title: "Computer Wins!", message: "Not this time. Ready for another round?" };
  }
  return {
    tone: "win" as ResultTone,
    title: `${config.names[winner]} Wins!`,
    message: "Nicely played — three in a row.",
  };
}

/** Text for the turn pill above the board. */
export function turnLabel(config: GameConfig, current: PlayerSymbol): string {
  if (config.opponent === "computer") return current === config.humanSymbol ? "Your turn" : "Computer is thinking…";
  return `${config.names[current]}'s turn`;
}
