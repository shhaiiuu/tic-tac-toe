import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createChatController, INITIAL_CHAT_STATE, type ChatController } from "@/lib/online/chat-controller";
import { getChatTransport } from "@/lib/online/chat-supabase";

const noopSubscribe = () => () => undefined;

/**
 * Chat for one room. A new controller is created whenever the room (or player) changes and the old
 * one is disposed, which closes its subscriptions and drops any late events.
 */
export function useRoomChat({ roomId, userId, myName }: { roomId: string; userId: string; myName: string }) {
  const [controller, setController] = useState<ChatController | null>(null);

  useEffect(() => {
    const c = createChatController({ transport: getChatTransport(), roomId, userId, myName });
    setController(c);
    return () => {
      c.dispose();
      setController(null);
    };
  }, [roomId, userId, myName]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getState ?? (() => INITIAL_CHAT_STATE),
    () => INITIAL_CHAT_STATE,
  );

  const actions = useMemo(
    () => ({
      send: (text: string) => controller?.send(text) ?? Promise.resolve(false),
      retry: (id: string) => controller?.retry(id) ?? Promise.resolve(false),
      reload: () => controller?.reload() ?? Promise.resolve(),
      setOpen: (open: boolean) => controller?.setOpen(open),
      notifyTyping: () => controller?.notifyTyping(),
      stopTyping: () => controller?.stopTyping(),
      clearError: () => controller?.clearError(),
    }),
    [controller],
  );

  return { state, ...actions };
}
