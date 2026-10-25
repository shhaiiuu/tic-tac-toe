// In-memory stand-in for the Supabase chat, used ONLY by tests. It enforces the same rules as the SQL
// in supabase/migrations/20261026000000_room_chat.sql: members only (read, send, live updates, typing),
// sender/name/time decided by the "server", text validation and rate limiting.
import { ChatError, MAX_MESSAGE_LENGTH, charCount, type ChatHandlers, type ChatMessage, type ChatTransport } from "./chat";

interface Sub {
  roomId: string;
  userId: string;
  handlers: ChatHandlers;
}

export class FakeChatBackend {
  /** roomId -> (userId -> display name) */
  rooms = new Map<string, Map<string, string>>();
  closedRooms = new Set<string>();
  messages: ChatMessage[] = [];
  clockMs = Date.UTC(2026, 9, 26, 12, 0, 0);
  /** Make the next send/fetch fail with this error. */
  failNext: "network" | null = null;
  /** Deliver the realtime copy BEFORE the insert call returns (the race that causes duplicates). */
  echoBeforeReply = false;
  private subs = new Set<Sub>();
  private seq = 0;

  addRoom(roomId: string, members: Record<string, string>) {
    this.rooms.set(roomId, new Map(Object.entries(members)));
  }

  private isMember(roomId: string, userId: string) {
    return this.rooms.get(roomId)?.has(userId) ?? false;
  }

  /** What the realtime server would push: only to members of that room. */
  private broadcast(m: ChatMessage) {
    for (const s of this.subs) if (s.roomId === m.roomId && this.isMember(s.roomId, s.userId)) s.handlers.onMessage(m);
  }

  transportFor(userId: string): ChatTransport {
    return {
      fetchHistory: async (roomId) => {
        if (this.failNext) {
          this.failNext = null;
          throw new ChatError("network");
        }
        if (!this.isMember(roomId, userId)) throw new ChatError("not_member"); // RLS: select denied
        return this.messages.filter((m) => m.roomId === roomId);
      },

      send: async (roomId, id, content) => {
        if (this.failNext) {
          this.failNext = null;
          throw new ChatError("network");
        }
        if (!this.isMember(roomId, userId)) throw new ChatError("not_member");
        if (this.closedRooms.has(roomId)) throw new ChatError("room_closed");
        const text = content.replace(/\r/g, "").trim();
        if (text.length === 0) throw new ChatError("empty");
        if (charCount(text) > MAX_MESSAGE_LENGTH) throw new ChatError("too_long");
        const recent = this.messages.filter((m) => m.senderId === userId && Date.parse(m.createdAt) > this.clockMs - 5000).length;
        if (recent >= 8) throw new ChatError("rate_limited");
        if (this.messages.some((m) => m.id === id)) throw new ChatError("unknown"); // primary key

        const stored: ChatMessage = {
          id,
          roomId,
          senderId: userId, // from the session, never from the client
          senderName: this.rooms.get(roomId)!.get(userId)!, // from the rooms table
          content: text,
          createdAt: new Date(this.clockMs + ++this.seq).toISOString(),
          state: "sent",
        };
        this.messages.push(stored);
        if (this.echoBeforeReply) this.broadcast(stored);
        else queueMicrotask(() => this.broadcast(stored));
        return stored;
      },

      subscribe: (roomId, handlers) => {
        const sub: Sub = { roomId, userId, handlers };
        this.subs.add(sub);
        queueMicrotask(() => handlers.onStatus("connected"));
        return {
          sendTyping: (typing) => {
            // private broadcast channel: only members of this room, never back to the sender
            if (!this.isMember(roomId, userId)) return;
            for (const s of this.subs) if (s !== sub && s.roomId === roomId && this.isMember(roomId, s.userId)) s.handlers.onTyping(typing);
          },
          close: () => void this.subs.delete(sub),
        };
      },
    };
  }

  /** Simulate a dropped and restored connection for one player. */
  dropConnection(userId: string, roomId: string) {
    for (const s of this.subs) if (s.userId === userId && s.roomId === roomId) s.handlers.onStatus("reconnecting");
  }
  restoreConnection(userId: string, roomId: string) {
    for (const s of this.subs) if (s.userId === userId && s.roomId === roomId) s.handlers.onStatus("connected");
  }
  get subscriberCount() {
    return this.subs.size;
  }
}
