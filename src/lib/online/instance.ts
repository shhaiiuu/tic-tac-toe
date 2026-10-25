import { createOnlineClient, INITIAL_ONLINE_STATE, type OnlineClient } from "./client";
import { createSupabaseTransport } from "./supabase";

let instance: OnlineClient | null = null;

/** Lazily created singleton. Creating it does no network work. */
export function getOnlineClient(): OnlineClient {
  instance ??= createOnlineClient(
    createSupabaseTransport(),
    typeof window === "undefined" ? null : window.sessionStorage,
  );
  return instance;
}

export { INITIAL_ONLINE_STATE };
