import { YOUTUBE_PLAYER_ORIGIN, readYoutubePlaylist, youtubeListening, youtubePlaylistProbeSrc } from "./youtube";

const TIMEOUT_MS = 12_000, LISTEN_EVERY_MS = 250, NONE_GRACE_MS = 1500;

/**
 * The video ids of a YouTube playlist, read from YouTube's own player (youtube.ts `youtubePlaylistProbeSrc`): an iframe out
 * of sight that plays nothing and is removed again. null = the player names no playlist (unknown, private, empty) or did
 * not answer in time. Always in the main page's document, also when the radio menu is open in the stage's own window.
 * It connects to YouTube even while the radio is turned off for oneself: the member asked for that playlist.
 */
export function resolveYoutubePlaylist(listId: string, videoId: string | null): Promise<string[] | null> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = youtubePlaylistProbeSrc(listId, videoId, window.location.origin);
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    // Not `display: none`: a player that is not laid out may never start up.
    Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "320px", height: "180px", border: "0", visibility: "hidden" });
    let listen: ReturnType<typeof setInterval> | null = null;
    let none: ReturnType<typeof setTimeout> | undefined;
    const finish = (ids: string[] | null) => {
      if (listen !== null) clearInterval(listen);
      clearTimeout(timeout); clearTimeout(none);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(ids);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== YOUTUBE_PLAYER_ORIGIN) return;
      const list = readYoutubePlaylist(event.data);
      if (Array.isArray(list)) finish(list);
      // "No playlist" in the first report: a list that is only slow would still follow in a later one.
      else if (list === "none") none ??= setTimeout(() => finish(null), NONE_GRACE_MS);
    };
    const timeout = setTimeout(() => finish(null), TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", () => {
      const say = () => { try { frame.contentWindow?.postMessage(youtubeListening(), YOUTUBE_PLAYER_ORIGIN); } catch { /* gone */ } };
      listen = setInterval(say, LISTEN_EVERY_MS);
      say();
    });
    document.body.appendChild(frame);
  });
}
