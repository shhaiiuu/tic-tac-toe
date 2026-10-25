// Chat types, validation and helpers. Pure TypeScript (no React, no Supabase) so it is easy to test.

export const MAX_MESSAGE_LENGTH = 500;
export const HISTORY_LIMIT = 100;

export type MessageState = "sent" | "sending" | "failed";

export interface ChatMessage {
  readonly id: string;
  readonly roomId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly content: string;
  /** ISO timestamp. For a message still being sent this is the local time until the server confirms. */
  readonly createdAt: string;
  readonly state: MessageState;
}

export type ChatErrorCode = "empty" | "too_long" | "not_member" | "room_closed" | "rate_limited" | "network" | "unknown";

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode) {
    super(code);
  }
}

const TEXT: Record<ChatErrorCode, string> = {
  empty: "Type a message first.",
  too_long: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`,
  not_member: "You can only chat in your own room.",
  room_closed: "This room has been closed.",
  rate_limited: "You're sending messages too fast. Wait a moment.",
  network: "Couldn't reach the chat. Check your connection.",
  unknown: "Something went wrong with the chat.",
};
export const chatErrorText = (code: ChatErrorCode) => TEXT[code];
export const errorCodeOf = (err: unknown): ChatErrorCode => (err instanceof ChatError ? err.code : "unknown");

/** Length in characters as Postgres counts them (an emoji is 1, not 2). */
export const charCount = (s: string) => Array.from(s).length;

export type Validation = { ok: true; content: string } | { ok: false; error: "empty" | "too_long" };

/** Trims, normalises line endings, rejects empty / whitespace-only / over-long text. */
export function validateMessage(raw: string): Validation {
  const content = raw.replace(/\r/g, "").trim();
  if (content.length === 0) return { ok: false, error: "empty" };
  if (charCount(content) > MAX_MESSAGE_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, content };
}

/** Insert or update by id, keeping an existing message's position (so a confirmed message never jumps). */
export function upsertMessage(list: readonly ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const i = list.findIndex((m) => m.id === msg.id);
  if (i === -1) return [...list, msg];
  const next = list.slice();
  next[i] = msg;
  return next;
}

/** History (server order) first, then anything that arrived live and isn't in the history yet. */
export function mergeHistory(history: readonly ChatMessage[], live: readonly ChatMessage[]): ChatMessage[] {
  const known = new Set(history.map((m) => m.id));
  return [...history, ...live.filter((m) => !known.has(m.id))];
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export type ConnectionStatus = "connected" | "reconnecting";

export interface ChatHandlers {
  onMessage(message: ChatMessage): void;
  /** The OTHER player started/stopped typing (own typing is never delivered). */
  onTyping(typing: boolean): void;
  onStatus(status: ConnectionStatus): void;
}

export interface ChatSubscription {
  sendTyping(typing: boolean): void;
  close(): void;
}

/** Everything the chat needs from a backend. The real one is Supabase; tests use an in-memory fake. */
export interface ChatTransport {
  fetchHistory(roomId: string): Promise<ChatMessage[]>;
  /** Persists the message (the server decides sender, name and time) and returns the stored row. */
  send(roomId: string, id: string, content: string): Promise<ChatMessage>;
  subscribe(roomId: string, handlers: ChatHandlers): ChatSubscription;
}
