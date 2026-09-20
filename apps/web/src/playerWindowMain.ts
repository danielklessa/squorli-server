import { playerFrameAllow, playerOriginOf, type PlayerWindowMessage } from "./playerWindow";

/**
 * Script of player-window.html (see playerWindow.ts): shows the player named by `?src=` (Twitch's or YouTube's official
 * player only) and relays messages between it and the window that opened this one. Nothing else: no session, no
 * connection to the chat server. Opened by hand (no opener) or with another address it stays empty.
 */
const params = new URLSearchParams(window.location.search);
const src = params.get("src") ?? "";
const origin = playerOriginOf(src);
const opener = window.opener as Window | null;
document.title = `${params.get("title") ?? ""} | Squorli`.replace(/^ \| /, "");

if (origin && opener) {
  const frame = document.createElement("iframe");
  frame.allow = playerFrameAllow(params.get("route") === "1");
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.title = document.title;
  frame.src = src;
  // Commands that arrive before the player's page is there would only be refused by the browser (wrong origin): dropped, the opener repeats them.
  let loaded = false;
  frame.addEventListener("load", () => { loaded = true; });
  document.body.appendChild(frame);

  const tell = (message: PlayerWindowMessage) => { try { opener.postMessage(message, window.location.origin); } catch { /* the opener is gone */ } };
  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && event.origin === origin) tell({ squorliPlayerWindow: "message", data: event.data });
    else if (event.source === opener && event.origin === window.location.origin && loaded) frame.contentWindow?.postMessage(event.data, origin);
  });
  document.addEventListener("visibilitychange", () => tell({ squorliPlayerWindow: "visibility", hidden: document.hidden }));
  tell({ squorliPlayerWindow: "visibility", hidden: document.hidden });
}
