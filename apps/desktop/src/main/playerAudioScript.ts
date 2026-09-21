import { CHAT_PLAYER_MARK } from "@squorli/web/platform/bridge";

/**
 * Output device of the embedded players (Twitch, YouTube as the web radio's source), pure part. A page cannot choose where a
 * foreign iframe plays (`setSinkId` exists per media element, inside the frame), so in a browser the players always use the
 * system's default device. The shell can: it runs the small script below inside the player's frame (playerAudio.ts).
 * Device ids are hashed per origin, so the client names the device by its LABEL and the script finds the frame's own id.
 */
export const PLAYER_ORIGINS: readonly string[] = ["https://player.twitch.tv", "https://www.youtube-nocookie.com"];

export function isPlayerFrameUrl(url: string | undefined): boolean {
  if (!url) return false;
  try { const u = new URL(url); return PLAYER_ORIGINS.includes(`${u.protocol}//${u.host}`); } catch { return false; }
}

/**
 * Two kinds of players, two devices: the web radio's players follow the radio's output device, the players of videos linked
 * in the chat follow the device of screen share audio (user's wish, 21 September 2026). The client marks a chat player's
 * address with the fragment CHAT_PLAYER_MARK, which never reaches the player's host. A frame that navigates inside itself
 * keeps or loses the mark with its address; without the mark it counts as the radio's.
 */
export type PlayerKind = "radio" | "chat";
export function playerKindOf(url: string | undefined): PlayerKind | null {
  if (!isPlayerFrameUrl(url)) return null;
  try { return new URL(url!).hash === CHAT_PLAYER_MARK ? "chat" : "radio"; } catch { return null; }
}

/** What the client may send: a device's label, or null = the system's default device. Anything else counts as null. */
export function readPlayerOutputLabel(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
}

export type PlayerAudioResult = { elements: number; moved: number; error?: string };

/**
 * Runs inside the player's frame: puts every media element on the device with this label (null = back to the default).
 * Elements already there are left alone, so running it again and again costs nothing (players make new elements: ads,
 * the next video). Leaves nothing behind in the page.
 */
export function playerAudioScript(label: string | null): string {
  return `(async (label) => {
  const els = [...document.querySelectorAll("video, audio")].filter((el) => typeof el.setSinkId === "function");
  if (els.length === 0) return { elements: 0, moved: 0 };
  let id = "";
  if (label !== null) {
    const device = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "audiooutput" && d.label === label);
    if (!device) return { elements: els.length, moved: 0, error: "no device with this label" };
    id = device.deviceId;
  }
  let moved = 0, error;
  for (const el of els) {
    if (el.sinkId === id) continue;
    try { await el.setSinkId(id); moved++; } catch (err) { error = String(err); }
  }
  return error ? { elements: els.length, moved, error } : { elements: els.length, moved };
})(${JSON.stringify(label)})`;
}
