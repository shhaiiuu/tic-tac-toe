import { useEffect, useRef } from "react";

const EMOJIS = ["😀", "😂", "🤣", "😊", "😍", "😎", "🤔", "😅", "😭", "😡", "👍", "👎", "👏", "🙌", "🔥", "🎉", "💪", "🤝", "😬", "🙈", "🥳", "😴", "🍀", "❤️"];

/** Small popover of common emojis. Closes on selection, Escape, or a click outside. */
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Choose an emoji"
      className="absolute bottom-full left-0 z-10 mb-2 grid w-56 grid-cols-6 gap-1 rounded-2xl border bg-card p-2 shadow-lift animate-pop"
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          className="grid size-8 place-items-center rounded-lg text-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
