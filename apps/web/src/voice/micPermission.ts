/**
 * Why was the microphone refused? (user's report, 19 September 2026: an iPhone's home screen app refuses with WebKit's one
 * text for everything, "The request is not allowed by the user agent or the platform in the current context, possibly
 * because the user denied permission", and never showed a prompt.) The browser's permission state tells the cases apart,
 * and the error text names it, so a report says which one it was.
 *
 * Pure logic (tested); `VoiceClient.join()` asks the state and picks the text.
 */
export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown";

export type MicRefusal =
  /** Stored as refused: only the browser's or the system's settings bring it back, the page cannot ask again. */
  | "denied"
  /** The browser would still have to ask and did not: it refused by itself (no tap that counts, a system restriction). */
  | "notAsked"
  /** Allowed for the site and refused all the same, or a browser that does not tell: the system keeps the microphone back. */
  | "system";

export function micRefusal(state: MicPermissionState): MicRefusal {
  if (state === "denied") return "denied";
  if (state === "prompt") return "notAsked";
  return "system";
}

/** The browser's stored decision for the microphone; "unknown" where the browser does not tell (older Safari, Firefox). */
export async function micPermissionState(): Promise<MicPermissionState> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch { return "unknown"; }
}
