import {
  chatErrorText,
  errorCodeOf,
  mergeHistory,
  upsertMessage,
  validateMessage,
  type ChatMessage,
  type ChatSubscription,
  type ChatTransport,
} from "./chat";

export interface ChatState {
  readonly messages: readonly ChatMessage[];
  readonly status: "loading" | "ready" | "error" | "reconnecting";
  /** Messages from the opponent that arrived while the chat was closed. */
  readonly unread: number;
  readonly open: boolean;
  readonly opponentTyping: boolean;
  /** True while one of my messages is being sent (the input disables its send button). */
  readonly sending: boolean;
  readonly error: string | null;
}

export const INITIAL_CHAT_STATE: ChatState = {
  messages: [],
  status: "loading",
  unread: 0,
  open: false,
  opponentTyping: false,
  sending: false,
  error: null,
};

export interface ChatControllerOptions {
  transport: ChatTransport;
  roomId: string;
  userId: string;
  myName: string;
  /** Hide the opponent's typing dots this long after their last typing signal. */
  typingExpiryMs?: number;
  /** Send my "typing" signal at most this often while I keep typing. */
  typingThrottleMs?: number;
  /** Tell the opponent I stopped typing after this much idle time. */
  typingIdleMs?: number;
  newId?: () => string;
  now?: () => number;
}

/**
 * Chat state for ONE room. Create a new controller when the room changes and `dispose()` the old one:
 * after dispose it ignores every late event, so nothing can leak from one room into another.
 */
export function createChatController(opts: ChatControllerOptions) {
  const {
    transport,
    roomId,
    userId,
    myName,
    typingExpiryMs = 3500,
    typingThrottleMs = 2000,
    typingIdleMs = 2500,
    newId = () => crypto.randomUUID(),
    now = () => Date.now(),
  } = opts;

  let state: ChatState = INITIAL_CHAT_STATE;
  let disposed = false;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ChatState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const withSending = (messages: readonly ChatMessage[]) => messages.some((m) => m.state === "sending");
  const setMessages = (messages: readonly ChatMessage[], extra: Partial<ChatState> = {}) =>
    set({ messages, sending: withSending(messages), ...extra });

  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTypingSentAt = -Infinity;
  let iAmTyping = false;

  const clearExpiry = () => {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  };
  const showOpponentTyping = (typing: boolean) => {
    clearExpiry();
    if (!typing) return set({ opponentTyping: false });
    set({ opponentTyping: true });
    expiryTimer = setTimeout(() => set({ opponentTyping: false }), typingExpiryMs); // stale indicators vanish by themselves
  };

  const sub: ChatSubscription = transport.subscribe(roomId, {
    onMessage(m) {
      if (disposed || m.roomId !== roomId) return; // never show another room's message
      const existing = state.messages.find((x) => x.id === m.id);
      const mine = m.senderId === userId;
      if (!existing && !mine) showOpponentTyping(false);
      setMessages(upsertMessage(state.messages, { ...m, state: "sent" }), {
        unread: !existing && !mine && !state.open ? state.unread + 1 : state.unread,
      });
    },
    onTyping: (typing) => !disposed && showOpponentTyping(typing),
    onStatus(status) {
      if (disposed) return;
      if (status === "reconnecting") return set({ status: "reconnecting" });
      // Back online after a drop: fetch again to catch anything missed meanwhile (load() sets "ready").
      if (state.status === "reconnecting") void load();
    },
  });

  async function load() {
    try {
      const history = await transport.fetchHistory(roomId);
      if (disposed) return;
      setMessages(mergeHistory(history, state.messages), { status: "ready", error: null });
    } catch (err) {
      if (!disposed) set({ status: "error", error: chatErrorText(errorCodeOf(err)) });
    }
  }
  void load();

  async function deliver(msg: ChatMessage): Promise<boolean> {
    try {
      const stored = await transport.send(roomId, msg.id, msg.content);
      if (disposed) return true;
      setMessages(upsertMessage(state.messages, { ...stored, state: "sent" })); // same id as the realtime copy: no duplicate
      return true;
    } catch (err) {
      if (disposed) return false;
      setMessages(upsertMessage(state.messages, { ...msg, state: "failed" }), { error: chatErrorText(errorCodeOf(err)) });
      return false;
    }
  }

  const stopTyping = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    if (iAmTyping) {
      iAmTyping = false;
      sub.sendTyping(false);
    }
    lastTypingSentAt = -Infinity;
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setOpen(open: boolean) {
      if (open === state.open) return;
      set({ open, unread: open ? 0 : state.unread });
    },

    async send(raw: string): Promise<boolean> {
      if (disposed || state.sending) return false;
      const v = validateMessage(raw);
      if (!v.ok) {
        set({ error: chatErrorText(v.error) });
        return false;
      }
      stopTyping();
      const msg: ChatMessage = {
        id: newId(),
        roomId,
        senderId: userId,
        senderName: myName,
        content: v.content,
        createdAt: new Date(now()).toISOString(),
        state: "sending",
      };
      setMessages(upsertMessage(state.messages, msg), { error: null }); // appears immediately
      return deliver(msg);
    },

    /** Try a failed message again (same id, so it can never be stored twice). */
    async retry(id: string): Promise<boolean> {
      const msg = state.messages.find((m) => m.id === id);
      if (disposed || !msg || msg.state !== "failed" || state.sending) return false;
      const again = { ...msg, state: "sending" as const };
      setMessages(upsertMessage(state.messages, again), { error: null });
      return deliver(again);
    },

    /** Reload history after a load error. */
    reload() {
      set({ status: "loading", error: null });
      return load();
    },

    clearError: () => state.error !== null && set({ error: null }),

    /** Call on every keystroke: sends a throttled "typing" signal and a "stopped" signal when idle. */
    notifyTyping() {
      if (disposed) return;
      if (now() - lastTypingSentAt >= typingThrottleMs) {
        lastTypingSentAt = now();
        iAmTyping = true;
        sub.sendTyping(true);
      }
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(stopTyping, typingIdleMs);
    },
    stopTyping,

    dispose() {
      if (disposed) return;
      stopTyping();
      clearExpiry();
      disposed = true; // from here on every late event is ignored
      listeners.clear();
      sub.close();
    },
  };
}

export type ChatController = ReturnType<typeof createChatController>;
