import { MessageCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRoomChat } from "@/hooks/use-room-chat";
import { cn } from "@/lib/utils";
import { ChatWindow } from "./chat-window";

/**
 * Floating chat for an online match: a round launcher (with an unread badge) in the bottom-right corner
 * that opens a chat panel above it. Mount it once per match; it owns the chat connection for that room.
 * If chat is unavailable (e.g. migration not applied) the game itself is unaffected.
 */
export function FloatingChat({
  roomId,
  userId,
  myName,
  opponentName,
}: {
  roomId: string;
  userId: string;
  myName: string;
  opponentName: string;
}) {
  const [open, setOpen] = useState(false);
  const chat = useRoomChat({ roomId, userId, myName });
  const { setOpen: syncOpen } = chat;

  useEffect(() => {
    syncOpen(open); // opening clears the unread count
  }, [open, syncOpen]);

  const unread = chat.state.unread;

  return (
    <div
      className="fixed z-40 flex flex-col items-end gap-3"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))", right: "max(1rem, env(safe-area-inset-right))" }}
    >
      {open && (
        <ChatWindow
          state={chat.state}
          userId={userId}
          opponentName={opponentName}
          onClose={() => setOpen(false)}
          onSend={chat.send}
          onRetry={(id) => void chat.retry(id)}
          onReload={() => void chat.reload()}
          onTyping={() => {
            chat.clearError();
            chat.notifyTyping();
          }}
          onStopTyping={chat.stopTyping}
        />
      )}

      <button
        type="button"
        aria-label={open ? "Close chat" : unread > 0 ? `Open chat, ${unread} unread message${unread === 1 ? "" : "s"}` : "Open chat"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lift transition-all duration-200",
          "hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-coral px-1.5 text-[11px] font-bold leading-5 text-coral-foreground shadow-soft animate-pop">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
