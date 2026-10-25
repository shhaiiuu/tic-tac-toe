import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TransportError } from "./messages";
import type { CallResult, RoomAction, RoomRow, Transport } from "./transport";

// Lovable Cloud / the Supabase integration injects these names automatically; set them in
// `.env.local` when running locally (see supabase/README.md).
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const key = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? import.meta.env["VITE_SUPABASE_ANON_KEY"]) as
  | string
  | undefined;

export const isOnlineConfigured = () => Boolean(url && key);

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!url || !key) throw new TransportError("not_configured");
  client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export function createSupabaseTransport(): Transport {
  return {
    async getUserId() {
      const sb = getClient();
      const { data } = await sb.auth.getSession();
      if (data.session) return data.session.user.id;
      // Anonymous sign-in gives every player a real auth.uid() without an account.
      const { data: signedIn, error } = await sb.auth.signInAnonymously();
      if (error || !signedIn.user) {
        throw new TransportError(/anonymous/i.test(error?.message ?? "") ? "auth_disabled" : "unauthorized");
      }
      return signedIn.user.id;
    },

    async call(action: RoomAction): Promise<CallResult> {
      const startedAt = performance.now();
      const { data, error } = await getClient().functions.invoke("rooms", { body: action });
      console.info(
        `[online timing] Edge Function ${action.action}: ${Math.round(performance.now() - startedAt)} ms`,
      );
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 404) throw new TransportError("not_deployed");
        if (status === 401) throw new TransportError("unauthorized");
        throw new TransportError("network");
      }
      return data as CallResult;
    },

    async fetchRoom(code) {
      const { data, error } = await getClient().from("rooms").select("*").eq("code", code).maybeSingle();
      if (error) throw new TransportError("network");
      return (data as RoomRow | null) ?? null;
    },

    watch(code, userId, handlers) {
      const sb = getClient();
      const channel = sb.channel(`room:${code}`, { config: { presence: { key: userId } } });
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` }, (payload) => {
          const receivedAt = performance.now();
          const row = payload.new as unknown as RoomRow | Record<string, never>;
          if ("id" in row) {
            console.info(
              `[online timing] Realtime row received: version ${"version" in row ? row.version : "unknown"} (${Math.round(receivedAt)} ms since page navigation)`,
            );
            handlers.onRow(row);
          }
        })
        .on("presence", { event: "sync" }, () => handlers.onPresence(Object.keys(channel.presenceState())))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void channel.track({ at: Date.now() });
            handlers.onResync();
          }
        });
      return () => {
        void sb.removeChannel(channel);
      };
    },
  };
}
