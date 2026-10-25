import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, type ChatMessage as Message } from "@/lib/online/chat";

/**
 * One bubble. My messages sit on the right, my opponent's on the left. The sender's name is only shown
 * above the first bubble of a run. Text is rendered as plain text (never HTML) and wraps long words.
 */
export function ChatMessage({
  message,
  mine,
  showName,
  onRetry,
}: {
  message: Message;
  mine: boolean;
  showName: boolean;
  onRetry: (id: string) => void;
}) {
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {mine ? (
  showName && (
    <span className="mb-1 mr-1 text-xs font-semibold text-muted-foreground">
      You
    </span>
  )
) : (
  showName && (
    <span className="mb-1 ml-1 text-xs font-semibold text-muted-foreground">
      {message.senderName}
    </span>
  )
)}
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-snug [overflow-wrap:anywhere]",
          mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
          message.state === "sending" && "opacity-70",
        )}
      >
        {message.content}
      </div>
      <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
        {message.state === "failed" ? (
          <>
            <span className="font-medium text-coral">Not sent</span>
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="inline-flex items-center gap-1 rounded-md font-semibold text-coral underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="size-3" /> Retry
            </button>
          </>
        ) : message.state === "sending" ? (
          <span>Sending…</span>
        ) : (
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        )}
      </div>
    </div>
  );
}
