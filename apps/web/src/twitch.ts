/**
 * Twitch's official player as a radio source, pure part. Twitch lets no foreign page play its streams as audio, so a
 * Twitch source is shown with the official embed (an iframe of player.twitch.tv; user's decision of 17 September 2026).
 * We do NOT load Twitch's embed script: it would run inside our page with access to the session in localStorage. The
 * iframe alone is isolated by its origin, and the script is only a thin wrapper around `postMessage`, which we speak
 * ourselves (format read from https://player.twitch.tv/js/embed/v1.js; not a documented contract, so every message is
 * harmless if Twitch stops understanding it: the player then simply keeps its own volume).
 */
export const TWITCH_PLAYER_ORIGIN = "https://player.twitch.tv";
const NAMESPACE = "twitch-embed-player-proxy";
/** Command numbers of the embed script (enum order there). */
const PLAY = 3, SET_MUTED = 10, SET_VOLUME = 11;

/**
 * Address of the player. `parent` must be the host name of the embedding page or Twitch refuses to play (and it wants
 * https there, except on localhost). Starts muted: the volume can only be set once the player is ready, and Twitch's
 * own default is far louder than our radio volume.
 */
export function twitchPlayerSrc(channel: string, parentHost: string): string {
  const q = new URLSearchParams({ channel, parent: parentHost, autoplay: "true", muted: "true" });
  return `${TWITCH_PLAYER_ORIGIN}/?${q.toString()}`;
}

/**
 * Twitch pauses its player when it gets too small, and does not start it again while it stays small. Measured on
 * 17 September 2026: plays at 316 x 178 px, pauses at 276 x 155 px. (Twitch's guidelines ask for 400 x 300.)
 */
export const TWITCH_MIN_WIDTH = 320, TWITCH_MIN_HEIGHT = 180;
const FLOAT_MARGIN = 12;

export type Box = { left: number; top: number; width: number; height: number };

/**
 * Where the player goes: over the slot (the tile in the voice stage) when that is on screen and big enough, otherwise as a
 * small floating window in the bottom right corner, so it stays visible and keeps playing while the user reads a text
 * channel, or while its tile is one of the small ones.
 */
export function twitchPlayerBox(slot: Box | null, viewport: { width: number; height: number }): Box & { floating: boolean } {
  if (slot && slot.width >= TWITCH_MIN_WIDTH && slot.height >= TWITCH_MIN_HEIGHT) return { left: Math.round(slot.left), top: Math.round(slot.top), width: Math.round(slot.width), height: Math.round(slot.height), floating: false };
  return { left: Math.max(0, viewport.width - TWITCH_MIN_WIDTH - FLOAT_MARGIN), top: Math.max(0, viewport.height - TWITCH_MIN_HEIGHT - FLOAT_MARGIN), width: TWITCH_MIN_WIDTH, height: TWITCH_MIN_HEIGHT, floating: true };
}

export type TwitchCommand = { eventName: number; params: unknown; namespace: string };

/** Volume first, then the mute state: unmuting at the player's old volume would blast for a moment. */
export function twitchAudioCommands(volume: number, muted: boolean): TwitchCommand[] {
  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  return [{ eventName: SET_VOLUME, params: v, namespace: NAMESPACE }, { eventName: SET_MUTED, params: muted || v === 0, namespace: NAMESPACE }];
}

/**
 * Twitch pauses an embedded player the moment its page is hidden (another browser tab, a minimized or covered window;
 * measured on 17 September 2026: 37 ms after `visibilitychange`), ignores Play while hidden, and does not start again
 * by itself when the page comes back. So we start it again when the page is visible again, unless the viewer paused it
 * themselves, which only happens while the page is visible. (Listening with the tab in the background needs the pop-out
 * window: a window of its own stays visible.)
 */
export const twitchPlayCommand = (): TwitchCommand => ({ eventName: PLAY, params: null, namespace: NAMESPACE });

/** "playing" / "paused" when the message says the playback started or stopped, null for everything else. */
export function twitchPlaybackEvent(data: unknown): "playing" | "paused" | null {
  if (!data || typeof data !== "object") return null;
  const { namespace, eventName } = data as Record<string, unknown>;
  if (namespace !== "twitch-embed") return null;
  if (eventName === "playing" || eventName === "play" || eventName === "video.play") return "playing";
  return eventName === "pause" || eventName === "video.pause" ? "paused" : null;
}

/** The player's regular state update: is it sitting there without playing ("Idle", "Ready", "Ended")? null = not a state update. */
export function twitchIsIdle(data: unknown): boolean | null {
  if (!data || typeof data !== "object") return null;
  const { namespace, eventName, params } = data as Record<string, unknown>;
  if (namespace !== NAMESPACE || eventName !== "UPDATE_STATE" || !params || typeof params !== "object") return null;
  const playback = (params as { playback?: unknown }).playback;
  return typeof playback === "string" ? playback !== "Playing" && playback !== "Buffering" : null;
}

/** Does this message from the iframe say the player can take commands now? (Its state updates and ready events do.) */
export function isTwitchPlayerSignal(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const { namespace, eventName } = data as Record<string, unknown>;
  if (namespace === NAMESPACE) return eventName === "UPDATE_STATE";
  return namespace === "twitch-embed" && (eventName === "ready" || eventName === "video.ready" || eventName === "playing" || eventName === "video.play");
}
