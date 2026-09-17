import { radioPositionAt, type RadioPlayback } from "@squorli/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TwitchControl, YoutubeControl, type EmbedControl } from "./embedControl";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { playerWindowUrl, readPlayerWindowMessage } from "./playerWindow";
import { TWITCH_PLAYER_ORIGIN, twitchPlayerBox, twitchPlayerSrc } from "./twitch";
import { YOUTUBE_PLAYER_ORIGIN, youtubePlayerSrc } from "./youtube";

/**
 * A radio source that is a video: Twitch's or YouTube's official player. The player itself is ONE iframe that lives in
 * App for as long as the voice channel plays such a source: moving an iframe in the DOM reloads it, and unmounting it with
 * the stage would cut the sound the moment the user looks at a text channel. So the tile in the voice stage only reserves
 * room (`EmbedSlot`) and the player lays itself over it, completely: no bar or label of ours (user's decision: a bar got
 * in the way of the player's controls, and the players show the title on hover by themselves). The one control of ours is
 * "open in a window of its own", shown on hover like on the video tiles. Without a slot on screen, or with one Twitch
 * would not play in (it pauses a player that is too small), it floats in the bottom right corner (twitch.ts `twitchPlayerBox`).
 */
export type EmbedSource = { kind: "twitch"; channel: string } | { kind: "youtube"; videoId: string };
export const embedKeyOf = (source: EmbedSource | null): string | null => source === null ? null : source.kind === "twitch" ? `twitch:${source.channel}` : `youtube:${source.videoId}`;

/** Playing a video in step with everyone (YouTube): the shared state, the server's clock, and whether this viewer steers. */
export type EmbedSync = { playback: RadioPlayback; clockOffset: number; canControl: boolean; publish: (playback: { playing: boolean; position: number; rate: number }) => Promise<unknown> };

const slots = new Set<HTMLElement>();

export function EmbedSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    slots.add(el);
    return () => { slots.delete(el); };
  }, []);
  // The text only shows while the player is not lying over it: the tile is too small for the player.
  return <div ref={ref} className="embed-slot">{t("radio.playerFloating")}</div>;
}

/**
 * The player's window of its own (playerWindow.ts). While it is open the iframe lives there instead of in the page, still
 * driven from here; the tile offers to bring it back, and closing the window brings it back too. The window is closed
 * when there is nothing to play any more: the radio stopped or changed, the user left the voice channel or turned the
 * radio off for themselves.
 */
export function usePlayerWindow(key: string | null) {
  const [win, setWin] = useState<Window | null>(null);
  useEffect(() => {
    if (!win) return;
    const timer = window.setInterval(() => { if (win.closed) setWin(null); }, 500);
    const close = () => win.close();
    window.addEventListener("pagehide", close);
    return () => { window.clearInterval(timer); window.removeEventListener("pagehide", close); };
  }, [win]);
  // Nothing to play (any more), or something else: the window goes. Also runs when the component unmounts.
  useEffect(() => () => { setWin((w) => { w?.close(); return null; }); }, [key]);
  return {
    win,
    /** false = the browser refused the window (pop-up blocker). */
    open: (url: string): boolean => {
      const w = window.open(url, "squorli-player", "popup,width=854,height=480");
      if (w) setWin(w);
      return w !== null;
    },
    restore: () => { setWin((w) => { w?.close(); return null; }); },
  };
}
export type PlayerWindow = ReturnType<typeof usePlayerWindow>;

function largestSlot(): DOMRect | null {
  let best: DOMRect | null = null;
  for (const el of slots) {
    const rect = el.getBoundingClientRect();
    if (!best || rect.width * rect.height > best.width * best.height) best = rect;
  }
  return best;
}

/**
 * `volume` is the user's radio volume, `muted` = deafened; both reach the player by postMessage, and so does everything
 * else (embedControl.ts). Rendered only while the user has not turned the radio off for themselves: no iframe, no
 * connection to Twitch or YouTube, no tile (user's requirement).
 */
export function EmbedPlayer({ source, name, volume, muted, popout, sync, onNotice }: { source: EmbedSource; name: string; volume: number; muted: boolean; popout: PlayerWindow; sync: EmbedSync | null; onNotice: (text: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const control = useRef<EmbedControl | null>(null);
  const live = useRef({ volume, muted, sync, onNotice });
  live.current = { volume, muted, sync, onNotice };
  const key = embedKeyOf(source)!;
  const win = popout.win;
  const origin = source.kind === "twitch" ? TWITCH_PLAYER_ORIGIN : YOUTUBE_PLAYER_ORIGIN;

  // A fresh address whenever a new iframe is made (in the page, or for the window): a video starts where it stands for everyone right now.
  const buildSrc = () => {
    if (source.kind === "twitch") return twitchPlayerSrc(source.channel, window.location.hostname);
    const s = live.current.sync;
    return youtubePlayerSrc(source.videoId, window.location.origin, s ? radioPositionAt(s.playback, Date.now() + s.clockOffset) : 0, s?.playback.playing ?? true);
  };
  const src = useMemo(buildSrc, [key, win]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the slot. Tiles move without any resize of their own (another tile appears, the view changes), so the
  // position is read once per frame instead of trusting observers: one getBoundingClientRect, no layout work of ours.
  useEffect(() => {
    if (win) return;
    let raf = 0;
    let last = "";
    const tick = () => {
      const el = box.current;
      if (el) {
        const b = twitchPlayerBox(largestSlot(), { width: window.innerWidth, height: window.innerHeight });
        const next = `${b.left}|${b.top}|${b.width}|${b.height}|${b.floating}`;
        if (next !== last) {
          last = next;
          Object.assign(el.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
          el.classList.toggle("floating", b.floating);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [win]);

  // One control per iframe: a new one for another source and whenever the iframe moves between the page and the window.
  useEffect(() => {
    let windowHidden = false;
    const link = {
      post: (data: unknown) => {
        try {
          if (win) win.postMessage(data, window.location.origin);
          else frame.current?.contentWindow?.postMessage(data, origin);
        } catch { /* the window is gone */ }
      },
      isHidden: () => win ? windowHidden : document.hidden,
    };
    let lastNotice = 0;
    const notice = (text: string) => { if (Date.now() - lastNotice > 10_000) { lastNotice = Date.now(); live.current.onNotice(text); } };
    const soundBlocked = () => notice(t("radio.soundBlocked"));
    const c: EmbedControl = source.kind === "twitch" ? new TwitchControl(link, soundBlocked) : new YoutubeControl(link, {
      serverNow: () => Date.now() + (live.current.sync?.clockOffset ?? 0),
      canControl: () => live.current.sync?.canControl ?? false,
      publish: (playback) => live.current.sync ? live.current.sync.publish(playback) : Promise.reject(new Error("no sync")),
      onCorrected: () => notice(t("radio.syncFollowOnly")),
      onSoundBlocked: soundBlocked,
      onError: (kind) => live.current.onNotice(t(kind === "embedding" ? "radio.errNotEmbeddable" : kind === "missing" ? "radio.errUnknownVideo" : "radio.errPlayer")),
    });
    control.current = c;
    c.setAudio(live.current.volume, live.current.muted);
    if (c instanceof YoutubeControl && live.current.sync) c.setShared(live.current.sync.playback);
    if (win) c.start(); // in the page: once the iframe has loaded (onLoad below)

    const onMessage = (event: MessageEvent) => {
      if (win) {
        if (event.source !== win || event.origin !== window.location.origin) return;
        const message = readPlayerWindowMessage(event.data);
        if (!message) return;
        if (message.squorliPlayerWindow === "visibility") { windowHidden = message.hidden; if (!message.hidden) c.onVisible(); }
        else c.onMessage(message.data);
      } else if (event.source === frame.current?.contentWindow && event.origin === origin) c.onMessage(event.data);
    };
    const onVisibility = () => { if (!win && !document.hidden) c.onVisible(); };
    const onGesture = () => c.onGesture();
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
    return () => { window.removeEventListener("message", onMessage); document.removeEventListener("visibilitychange", onVisibility); document.removeEventListener("pointerdown", onGesture, true); document.removeEventListener("keydown", onGesture, true); c.close(); control.current = null; };
  }, [key, win, origin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { control.current?.setAudio(volume, muted); }, [volume, muted]);
  const playback = sync?.playback ?? null;
  useEffect(() => { if (playback && control.current instanceof YoutubeControl) control.current.setShared(playback); }, [playback]);

  if (win) return null;
  const openWindow = () => { if (!popout.open(playerWindowUrl(buildSrc(), name))) onNotice(t("stage.popupBlocked")); };
  return createPortal(
    <div ref={box} className={`embed-player ${source.kind}`}>
      <iframe ref={frame} key={src} src={src} title={t("radio.playerFrame", { name })} onLoad={() => control.current?.start()}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      <div className="tile-window-actions">
        <button className="icon" title={t("stage.popout")} aria-label={t("stage.popout")} onClick={openWindow}><Icon name="external-link" /></button>
      </div>
    </div>, document.body,
  );
}
