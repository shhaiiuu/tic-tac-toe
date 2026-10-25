import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatState } from "@/lib/online/chat-controller";
import { ChatInput } from "./chat-input";
import { ChatMessage } from "./chat-message";
import { TypingIndicator } from "./typing-indicator";

export interface ChatWindowProps {
  state: ChatState;
  userId: string;
  opponentName: string;
  onClose: () => void;
  onSend: (text: string) => Promise<boolean>;
  onRetry: (id: string) => void;
  onReload: () => void;
  onTyping: () => void;
  onStopTyping: () => void;
}

/** The floating panel: header, scrolling messages, typing indicator and the input. */
export function ChatWindow({ state, userId, opponentName, onClose, onSend, onRetry, onReload, onTyping, onStopTyping }: ChatWindowProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const { messages } = state;
  const last = messages[messages.length - 1];

  // Follow new messages only if the reader is already at the bottom, or the new message is mine.
  useEffect(() => {
    const el = listRef.current;
    if (el && (stickToBottom.current || last?.senderId === userId)) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.state, last?.senderId, state.opponentTyping, userId]);

  return (
    <section
      role="dialog"
      aria-label="Match chat"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="flex h-[28rem] max-h-[calc(100dvh-7rem)] w-[calc(100vw-2rem)] max-w-[22.5rem] flex-col overflow-hidden rounded-[1.75rem] border bg-card shadow-lift animate-pop"
    >
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-primary-soft text-primary">
          <MessageCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold leading-tight">Match Chat</h2>
          <p className="truncate text-xs text-muted-foreground">
            {state.status === "reconnecting" ? "Reconnecting…" : `Chat with ${opponentName}`}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-5" />
        </button>
      </header>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {state.status === "loading" && messages.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Loading messages…</p>}

        {state.status === "error" && messages.length === 0 && (
          <div className="py-8 text-center text-sm">
            <p className="text-coral">{state.error ?? "Couldn't load messages."}</p>
            <button type="button" onClick={onReload} className="mt-2 rounded-lg font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && messages.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-coral-soft text-2xl">👋</div>
              <p className="font-display text-base font-semibold">Say hello to your opponent!</p>
              <p className="mt-1 text-sm text-muted-foreground">Messages stay in this room only.</p>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <ChatMessage key={m.id} message={m} mine={m.senderId === userId} showName={i === 0 || messages[i - 1]?.senderId !== m.senderId} onRetry={onRetry} />
        ))}

        {state.opponentTyping && <TypingIndicator name={opponentName} />}
      </div>

      {state.error && messages.length > 0 && (
        <p role="alert" className="border-t bg-coral-soft px-4 py-2 text-xs font-medium text-coral">
          {state.error}
        </p>
      )}

      <ChatInput disabled={state.sending} onSend={onSend} onTyping={onTyping} onStopTyping={onStopTyping} />
    </section>
  );
}
