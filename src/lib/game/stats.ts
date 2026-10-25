import type { GameMode, OpponentType } from "./types";

/**
 * a / b meaning depends on the opponent:
 *  - computer: a = your wins, b = computer wins
 *  - friend:   a = Player 1 (X) wins, b = Player 2 (O) wins
 */
export interface StatLine {
  readonly a: number;
  readonly b: number;
  readonly draws: number;
}
export type Stats = Readonly<Record<string, StatLine>>;
export type Outcome = "a" | "b" | "draw";

const KEY = "tic-tac-toe:stats:v1";
const EMPTY: Stats = {};
const ZERO: StatLine = { a: 0, b: 0, draws: 0 };

export const statKey = (mode: GameMode, opponent: OpponentType) => `${mode}:${opponent}`;
export const lineFor = (stats: Stats, mode: GameMode, opponent: OpponentType): StatLine =>
  stats[statKey(mode, opponent)] ?? ZERO;

let cache: Stats | null = null;
const listeners = new Set<() => void>();
let storageHooked = false;

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function read(): Stats {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const out: Record<string, StatLine> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const v = value as Partial<Record<keyof StatLine, unknown>>;
      if (isCount(v?.a) && isCount(v?.b) && isCount(v?.draws)) out[key] = { a: v.a, b: v.b, draws: v.draws };
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function write(next: Stats) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota): stats still work for this visit.
  }
  emit();
}

/** Stable snapshot for useSyncExternalStore (same object until something changes). */
export function getStats(): Stats {
  if (typeof window === "undefined") return EMPTY;
  cache ??= read();
  return cache;
}
export const getServerStats = (): Stats => EMPTY;

export function subscribeStats(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageHooked) {
    storageHooked = true;
    window.addEventListener("storage", (e) => {
      if (e.key === KEY || e.key === null) {
        cache = null;
        emit();
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function recordOutcome(mode: GameMode, opponent: OpponentType, outcome: Outcome) {
  const stats = getStats();
  const key = statKey(mode, opponent);
  const line = stats[key] ?? ZERO;
  write({
    ...stats,
    [key]: {
      a: line.a + (outcome === "a" ? 1 : 0),
      b: line.b + (outcome === "b" ? 1 : 0),
      draws: line.draws + (outcome === "draw" ? 1 : 0),
    },
  });
}

export function resetStats() {
  write({});
}
