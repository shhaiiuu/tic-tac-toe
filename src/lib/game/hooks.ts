import { useSyncExternalStore } from "react";
import { getSession, subscribeSession, type Session } from "./session";
import { getServerStats, getStats, subscribeStats, type Stats } from "./stats";

export function useSession(): Session | null {
  return useSyncExternalStore(subscribeSession, getSession, () => null);
}

export function useStats(): Stats {
  return useSyncExternalStore(subscribeStats, getStats, getServerStats);
}
