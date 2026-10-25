import { useSyncExternalStore } from "react";
import { INITIAL_ONLINE_STATE } from "./client";
import { getOnlineClient } from "./instance";

export function useOnline() {
  const client = getOnlineClient();
  const state = useSyncExternalStore(client.subscribe, client.getState, () => INITIAL_ONLINE_STATE);
  return { state, client };
}
