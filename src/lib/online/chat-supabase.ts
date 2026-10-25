import { getClient } from "./supabase";
import { ChatError, HISTORY_LIMIT, type ChatErrorCode, type ChatHandlers, type ChatMessage, type ChatTransport } from "./chat";

interface Row {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

const toMessage = (r: Row): ChatMessage => ({
  id: r.id,
  roomId: r.room_id,
  senderId: r.sender_id,
  senderName: r.sender_name,
  content: r.content,
  createdAt: r.created_at,
  state: "sent",
});

/** Maps the database's error text (raised by the insert trigger / RLS) to a friendly code. */
function codeFromError(err: { message?: string; code?: string }): ChatErrorCode {
  const text = `${err.message ?? ""}`;
  for (const c of ["not_member", "room_closed", "rate_limited", "too_long", "empty"] as const) {
    if (text.includes(c)) return c;
  }
  if (err.code === "42501") return "not_member"; // row-level security refused the insert
  if (err.code === "23514") return "too_long";
  return "network";
}

/**
 * Supabase implementation:
 *  - messages are stored in public.room_messages (RLS: members only) and pushed live with Postgres Changes
 *  - typing indicators use a PRIVATE Broadcast channel "chat:<roomId>" (members only) and are never stored
 * The two live channels are separate on purpose: if typing isn't configured, messages still sync.
 */
export function createSupabaseChatTransport(): ChatTransport {
  return {
    async fetchHistory(roomId) {
      const { data, error } = await getClient()
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);
      if (error) throw new ChatError(codeFromError(error));
      return ((data ?? []) as Row[]).map(toMessage).reverse();
    },

    async send(roomId, id, content) {
      // Only id, room_id and content are accepted from the client; the database sets sender, name and time.
      const { data, error } = await getClient().from("room_messages").insert({ id, room_id: roomId, content }).select("*").single();
      if (error) throw new ChatError(codeFromError(error));
      return toMessage(data as Row);
    },

    subscribe(roomId, handlers: ChatHandlers) {
      const sb = getClient();

      const messages = sb
        .channel(`chat-messages:${roomId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` }, (payload) =>
          handlers.onMessage(toMessage(payload.new as Row)),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") handlers.onStatus("connected");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") handlers.onStatus("reconnecting");
        });

      const typing = sb
        .channel(`chat:${roomId}`, { config: { private: true, broadcast: { self: false } } })
        .on("broadcast", { event: "typing" }, ({ payload }) => handlers.onTyping(Boolean((payload as { typing?: unknown })?.typing)))
        .subscribe();

      return {
        sendTyping(isTyping: boolean) {
          void typing.send({ type: "broadcast", event: "typing", payload: { typing: isTyping } });
        },
        close() {
          void sb.removeChannel(messages);
          void sb.removeChannel(typing);
        },
      };
    },
  };
}

let instance: ChatTransport | null = null;
/** Lazily created; creating it does no network work. */
export function getChatTransport(): ChatTransport {
  instance ??= createSupabaseChatTransport();
  return instance;
}
