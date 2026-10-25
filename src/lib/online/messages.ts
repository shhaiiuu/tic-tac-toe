/** Friendly text for every error code the backend or transport can produce. */
const MESSAGES: Record<string, string> = {
  invalid_code: "That code doesn't look right. Room codes are 5 letters and numbers.",
  not_found: "No room found with that code. Check it and try again.",
  room_full: "That room already has two players.",
  expired: "That room has expired. Ask your friend to create a new one.",
  room_closed: "That room has been closed.",
  not_member: "You're not part of that room.",
  not_playing: "The game isn't in progress.",
  not_your_turn: "It's not your turn yet.",
  invalid_move: "That square isn't available.",
  conflict: "Something went wrong syncing the game. Please try again.",
  bad_request: "Something went wrong. Please try again.",
  unauthorized: "Couldn't sign you in. Please reload and try again.",
  auth_disabled:
    "Online play isn't fully set up: anonymous sign-ins are disabled in Supabase (Authentication → Providers → Anonymous).",
  not_deployed:
    "Online play isn't fully set up: the `rooms` Edge Function isn't deployed (run `supabase functions deploy rooms`).",
  not_configured: "Online play isn't configured yet.",
  network: "Couldn't reach the game server. Check your connection and try again.",
  server_error: "The game server hit a problem. Please try again.",
};

export const friendlyError = (code: string): string =>
  MESSAGES[code] ?? "Something went wrong. Please try again.";

/** Errors thrown by a transport carry a code; anything else is treated as a network problem. */
export class TransportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const errorCode = (err: unknown): string => (err instanceof TransportError ? err.code : "network");
