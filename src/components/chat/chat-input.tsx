import { Send, Smile } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { charCount, MAX_MESSAGE_LENGTH } from "@/lib/online/chat";
import { EmojiPicker } from "./emoji-picker";

/**
 * Message box. Enter sends, Shift+Enter inserts a new line. The send button is disabled while the
 * box is empty or a message is still being sent. Emojis are inserted at the cursor.
 */
export function ChatInput({
  disabled,
  onSend,
  onTyping,
  onStopTyping,
}: {
  /** A previous message is still being sent. */
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onTyping: () => void;
  onStopTyping: () => void;
}) {
  const [text, setText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const length = charCount(text);
  const canSend = !disabled && text.trim().length > 0 && length <= MAX_MESSAGE_LENGTH;

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`; // grows up to ~4 lines
  };

  const submit = async () => {
    if (!canSend) return;
    const value = text;
    setText("");
    requestAnimationFrame(resize);
    onStopTyping();
    await onSend(value); // a failed send stays in the list with a Retry button
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setPickerOpen(false);
    onTyping();
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
      resize();
    });
  };

  return (
    <div className="relative border-t bg-card p-3">
      {pickerOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setPickerOpen(false)} />}
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Add emoji"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((v) => !v)}
          className="grid size-10 shrink-0 place-items-center rounded-2xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Smile className="size-5" />
        </button>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          aria-label="Message"
          placeholder="Type a message..."
          autoComplete="off"
          enterKeyHint="send"
          onChange={(e) => {
            setText(e.target.value);
            resize();
            if (e.target.value.trim()) onTyping();
            else onStopTyping();
          }}
          onKeyDown={onKeyDown}
          className="max-h-24 min-h-10 flex-1 resize-none rounded-2xl border bg-muted px-3.5 py-2 text-base leading-snug placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
        />
        <button
          type="button"
          aria-label="Send message"
          disabled={!canSend}
          onClick={() => void submit()}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-soft transition-all hover:shadow-lift active:scale-95 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Send className="size-4" />
        </button>
      </div>
      {length > MAX_MESSAGE_LENGTH - 100 && (
        <p className={cn("mt-1 pr-1 text-right text-[11px]", length > MAX_MESSAGE_LENGTH ? "font-semibold text-coral" : "text-muted-foreground")}>
          {length}/{MAX_MESSAGE_LENGTH}
        </p>
      )}
    </div>
  );
}
