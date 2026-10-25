import { describe, expect, it } from "vitest";
import { charCount, mergeHistory, upsertMessage, validateMessage, MAX_MESSAGE_LENGTH, type ChatMessage } from "./chat";

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, roomId: "r", senderId: "u", senderName: "U", content: id, createdAt: "2026-10-26T12:00:00.000Z", state: "sent", ...over,
});

describe("validateMessage", () => {
  it("rejects empty and whitespace-only text", () => {
    for (const bad of ["", "   ", "\n\n", "\t \r\n"]) expect(validateMessage(bad)).toEqual({ ok: false, error: "empty" });
  });
  it("trims and normalises line endings", () => {
    expect(validateMessage("  hi\r\nthere  ")).toEqual({ ok: true, content: "hi\nthere" });
  });
  it("accepts exactly 500 characters and rejects 501", () => {
    expect(validateMessage("a".repeat(500)).ok).toBe(true);
    expect(validateMessage("a".repeat(501))).toEqual({ ok: false, error: "too_long" });
  });
  it("counts an emoji as one character, like the database does", () => {
    expect(charCount("😀")).toBe(1);
    expect(validateMessage("😀".repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
    expect(validateMessage("😀".repeat(MAX_MESSAGE_LENGTH + 1)).ok).toBe(false);
  });
  it("leaves markup as plain text (rendering escapes it)", () => {
    expect(validateMessage('<img src=x onerror="alert(1)">')).toEqual({ ok: true, content: '<img src=x onerror="alert(1)">' });
  });
});

describe("message list helpers", () => {
  it("upsert replaces by id and keeps the position", () => {
    const list = [msg("a"), msg("b", { state: "sending" }), msg("c")];
    const next = upsertMessage(list, msg("b", { state: "sent", createdAt: "2026-10-26T12:00:05.000Z" }));
    expect(next.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(next[1]?.state).toBe("sent");
    expect(upsertMessage(list, msg("d")).map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("history goes first and live messages are not duplicated", () => {
    const merged = mergeHistory([msg("a"), msg("b")], [msg("b"), msg("c")]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});
