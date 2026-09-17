import { TWITCH_PLAYER_ORIGIN } from "./twitch";
import { YOUTUBE_PLAYER_ORIGIN } from "./youtube";

/**
 * The embedded player (Twitch, YouTube) in a browser window of its own, pure part. The window shows a small page of OUR
 * origin (player-window.html) with the player's iframe in it, not the player's site itself: only so the window stays
 * under our control (volume, deafen, playing in step, Twitch's restart), because the players take commands from their
 * parent page only (measured: commands posted from the opener straight into the iframe are ignored), and only so it may
 * play with sound without a click inside it (measured with Chrome's default autoplay policy). The page relays messages
 * both ways and tells the opener when it is hidden or visible again.
 */
const ORIGINS = [TWITCH_PLAYER_ORIGIN, YOUTUBE_PLAYER_ORIGIN];

/** The origin of a player address the window may show, null for anything else (the page must not frame arbitrary sites under our name). */
export function playerOriginOf(src: string): string | null {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && ORIGINS.includes(u.origin) ? u.origin : null;
  } catch { return null; }
}

export function playerWindowUrl(src: string, title: string): string {
  return `/player-window.html?${new URLSearchParams({ src, title }).toString()}`;
}

/** What the window's page sends to its opener: a message of the player, or its own visibility. */
export type PlayerWindowMessage = { squorliPlayerWindow: "message"; data: unknown } | { squorliPlayerWindow: "visibility"; hidden: boolean };

export function readPlayerWindowMessage(data: unknown): PlayerWindowMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.squorliPlayerWindow === "message") return { squorliPlayerWindow: "message", data: d.data };
  if (d.squorliPlayerWindow === "visibility" && typeof d.hidden === "boolean") return { squorliPlayerWindow: "visibility", hidden: d.hidden };
  return null;
}
