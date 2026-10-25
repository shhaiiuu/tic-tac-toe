/** Opponent's name above the WhatsApp-style typing dots. */
export function TypingIndicator({ name }: { name: string }) {
  return (
    <div
      className="flex flex-col items-start gap-1 px-1"
      role="status"
      aria-live="polite"
    >
      <span className="text-xs font-semibold text-muted-foreground">
        {name}
      </span>

      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3 py-2"
          aria-hidden="true"
        >
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
              style={{
                animationDelay: `${delay}ms`,
                animationDuration: "1s",
              }}
            />
          ))}
        </span>

        <span className="text-xs text-muted-foreground">
          is typing
        </span>
      </div>
    </div>
  );
}