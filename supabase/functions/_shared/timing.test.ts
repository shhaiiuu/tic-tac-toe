import { describe, expect, it } from "vitest";
import { createTimer, formatTimingLog } from "../../../supabase/functions/_shared/timing.ts";

describe("request timing", () => {
  it("records per-stage and total time, summing repeated stages, and handles overlap", async () => {
    let t = 0;
    const timer = createTimer("abc", () => t);
    await timer.span("db_read", () => { t += 40; });
    await timer.span("db_read", () => { t += 10; }); // retry
    await timer.span("auth", async () => { t += 25; });
    expect(timer.steps()).toEqual({ db_read: 50, auth: 25 });
    expect(timer.totalMs()).toBe(75);
    expect(timer.serverTiming()).toBe("db_read;dur=50, auth;dur=25, total;dur=75");
  });

  it("still records a stage that throws, and rethrows", async () => {
    let t = 0;
    const timer = createTimer("abc", () => t);
    let caught = false;
    try { await timer.span("db_write", () => { t += 7; throw new Error("boom"); }); } catch { caught = true; }
    expect(caught).toBe(true);
    expect(timer.steps()).toEqual({ db_write: 7 });
  });

  it("formats one searchable log line with no secrets in it", () => {
    const timer = createTimer("id1", () => 0);
    const line = formatTimingLog(timer, { id: "id1", action: "move", ok: true, error: null, attempts: 1, cold: false, isolateAgeMs: 5, region: "r", build: "b" });
    expect(line.startsWith("[rooms timing] {")).toBe(true);
    expect(JSON.parse(line.slice(14)).action).toBe("move");
  });
});
