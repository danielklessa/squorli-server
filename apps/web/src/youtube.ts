/**
 * YouTube's official player as a radio source, pure part. As with Twitch (twitch.ts) we do NOT load YouTube's script
 * (iframe_api would run inside our page with access to the session in localStorage): the iframe alone is isolated by its
 * origin, and the script is only a wrapper around `postMessage`, which we speak ourselves. The messages are JSON strings
 * `{event, func, args, id, channel: "widget"}`; the player answers once it got a "listening" message and then reports its
 * state a few times per second (checked on 17 September 2026 against youtube-nocookie.com: state, time, rate, volume,
 * live flag, errors; all commands below work; the player keeps playing in a hidden tab). Not a documented contract: if
 * YouTube stops understanding it, the player simply plays on its own, at its own volume and out of step.
 * youtube-nocookie.com = YouTube's "privacy-enhanced mode": no cookies before the viewer plays something.
 */
export const YOUTUBE_PLAYER_ORIGIN = "https://www.youtube-nocookie.com";

/** Player states of YouTube's API. */
export const YT = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

/**
 * Address of the player. `origin` must be the embedding page's origin (the player only talks to that one). Starts muted:
 * the volume can only be set once the player answers, and YouTube's own default is far louder than our radio volume.
 * `start` = where the video stands for everyone right now, `autoplay` = whether it is playing for everyone.
 */
export function youtubePlayerSrc(videoId: string, pageOrigin: string, start: number, autoplay: boolean): string {
  const q = new URLSearchParams({ enablejsapi: "1", origin: pageOrigin, autoplay: autoplay ? "1" : "0", mute: "1", playsinline: "1", rel: "0" });
  const s = Math.floor(Number.isFinite(start) ? Math.max(0, start) : 0);
  if (s > 0) q.set("start", String(s));
  return `${YOUTUBE_PLAYER_ORIGIN}/embed/${encodeURIComponent(videoId)}?${q.toString()}`;
}

const envelope = (body: Record<string, unknown>): string => JSON.stringify({ ...body, id: 1, channel: "widget" });
/** "I am listening": the player starts reporting to the page that sent this. Repeated until the first report arrives. */
export const youtubeListening = (): string => envelope({ event: "listening" });
export const youtubeCommand = (func: string, ...args: unknown[]): string => envelope({ event: "command", func, args });

/** Volume first, then the mute state: unmuting at the player's old volume would blast for a moment. */
export function youtubeAudioCommands(volume: number, muted: boolean): string[] {
  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  return [youtubeCommand("setVolume", Math.round(v * 100)), youtubeCommand(muted || v === 0 ? "mute" : "unMute")];
}

/** What a message of the player tells us; every field only when the message names it (reports are partial). */
export type YoutubeInfo = { state?: number; time?: number; rate?: number; live?: boolean; error?: number };

export function readYoutubeMessage(data: unknown): YoutubeInfo | null {
  let msg: unknown = data;
  if (typeof data === "string") { try { msg = JSON.parse(data); } catch { return null; } }
  if (!msg || typeof msg !== "object") return null;
  const { event, info } = msg as { event?: unknown; info?: unknown };
  if (event === "onError") return typeof info === "number" ? { error: info } : {};
  if (event === "onReady") return {};
  if (event !== "infoDelivery" && event !== "initialDelivery") return null;
  if (!info || typeof info !== "object") return {};
  const i = info as Record<string, unknown>;
  const out: YoutubeInfo = {};
  if (typeof i.playerState === "number") out.state = i.playerState;
  if (typeof i.currentTime === "number" && Number.isFinite(i.currentTime)) out.time = i.currentTime;
  if (typeof i.playbackRate === "number" && i.playbackRate > 0) out.rate = i.playbackRate;
  const video = i.videoData;
  if (video && typeof video === "object" && typeof (video as { isLive?: unknown }).isLive === "boolean") out.live = (video as { isLive: boolean }).isLive;
  return out;
}

/** YouTube's error numbers: 2 = bad id, 5 = player error, 100 = gone or private, 101/150 = the owner forbids embedding. */
export function youtubeErrorKind(code: number): "embedding" | "missing" | "other" {
  return code === 101 || code === 150 ? "embedding" : code === 100 || code === 2 ? "missing" : "other";
}
