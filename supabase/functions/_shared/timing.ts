// Per-request timing for the `rooms` Edge Function. Pure TypeScript (no Deno APIs) so it can be
// unit-tested. Records how long each stage of a request took; it never records tokens, user ids
// or room codes.

/** Change this whenever the function changes, so you can confirm WHICH build is deployed. */
export const BUILD_ID = "rooms-timing-2026-10-25";

export interface Timer {
  readonly id: string;
  /** Time an async or sync stage. Stages may overlap (auth and the room read run in parallel). */
  span<T>(step: string, fn: () => Promise<T> | T): Promise<T>;
  /** Milliseconds per stage (summed if a stage runs more than once, e.g. a retry). */
  steps(): Record<string, number>;
  /** Milliseconds since the request started. */
  totalMs(): number;
  /** Value for the `Server-Timing` response header (visible in the browser Network tab). */
  serverTiming(): string;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function createTimer(id: string, now: () => number = () => performance.now()): Timer {
  const start = now();
  const totals: Record<string, number> = {};
  return {
    id,
    async span(step, fn) {
      const t0 = now();
      try {
        return await fn();
      } finally {
        totals[step] = (totals[step] ?? 0) + (now() - t0);
      }
    },
    steps: () => Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])),
    totalMs: () => round(now() - start),
    serverTiming() {
      const parts = Object.entries(totals).map(([k, v]) => `${k};dur=${round(v)}`);
      parts.push(`total;dur=${round(now() - start)}`);
      return parts.join(", ");
    },
  };
}

export interface RequestSummary {
  id: string;
  action: string;
  ok: boolean;
  error: string | null;
  /** How many times the read-validate-write loop ran (>1 means a version conflict was retried). */
  attempts: number;
  /** true = first request served by this function instance (cold start). */
  cold: boolean;
  isolateAgeMs: number;
  region: string;
  build: string;
}

/** One JSON line per request. Search the function logs for "[rooms timing]". */
export function formatTimingLog(timer: Timer, s: RequestSummary): string {
  return `[rooms timing] ${JSON.stringify({ ...s, total_ms: timer.totalMs(), steps: timer.steps() })}`;
}
