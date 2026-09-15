import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VoiceClient, VideoTile } from "./voice/voiceClient";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { attachVideoView, toggleVideoFullscreen } from "./videoDisplay";

export function TrackVideo({ tile }: { tile: VideoTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current!;
    return attachVideoView(tile.track, element);
  }, [tile.track]);
  return <video ref={ref} className={tile.isLocal && tile.source === "camera" ? "mirror" : ""} autoPlay playsInline muted />;
}

export function FullscreenButton({ target, onError }: { target: () => HTMLElement | null; onError: (message: string) => void }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = target();
    const doc = element?.ownerDocument;
    const update = () => setActive(!!element && doc?.fullscreenElement === element);
    update(); doc?.addEventListener("fullscreenchange", update);
    return () => doc?.removeEventListener("fullscreenchange", update);
  }, [target]);
  const toggle = async () => {
    const element = target();
    if (!element) return;
    onError("");
    try {
      if (!await toggleVideoFullscreen(element)) onError(t("stage.fullscreenUnavailable"));
    } catch { onError(t("stage.fullscreenFailed")); }
  };
  return <button className="icon" title={t(active ? "stage.exitFullscreen" : "stage.fullscreen")} aria-label={t(active ? "stage.exitFullscreen" : "stage.fullscreen")}
    onClick={(event) => { event.stopPropagation(); void toggle(); }}><Icon name={active ? "minimize" : "maximize"} /></button>;
}

type Entry = { id: string; window: Window; document: Document };
function isOpen(entry: Entry) {
  try { return !entry.window.closed && entry.window.document === entry.document; } catch { return false; }
}

/** Lives at App level so windows survive switching between the stage and text channels. */
export function useVideoWindows(tiles: VideoTile[], client: VoiceClient) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    const close = () => { for (const entry of entriesRef.current) entry.window.close(); };
    window.addEventListener("pagehide", close);
    return () => { window.removeEventListener("pagehide", close); close(); };
  }, []);
  useEffect(() => {
    if (entries.length === 0) return;
    const timer = window.setInterval(() => setEntries((old) => old.some((entry) => !isOpen(entry)) ? old.filter(isOpen) : old), 500);
    return () => window.clearInterval(timer);
  }, [entries.length]);
  useEffect(() => {
    const removed = entriesRef.current.filter((entry) => !tiles.some((tile) => tile.id === entry.id));
    for (const entry of removed) entry.window.close();
    if (removed.length) setEntries((old) => old.filter((entry) => !removed.includes(entry)));
  }, [tiles]);
  const open = (tile: VideoTile) => {
    const existing = entriesRef.current.find((entry) => entry.id === tile.id && isOpen(entry));
    if (existing) { existing.window.focus(); return; }
    // Must be synchronous inside the user's click, before any asynchronous work.
    const popup = window.open("about:blank", "_blank", "popup,width=960,height=600,resizable=yes,scrollbars=yes");
    if (!popup) throw new Error(t("stage.popupBlocked"));
    try {
      const base = popup.document.createElement("base"); base.href = document.baseURI; popup.document.head.appendChild(base);
      popup.document.documentElement.lang = document.documentElement.lang;
      for (const source of document.querySelectorAll('link[rel="stylesheet"], style')) {
        const copy = source.cloneNode(true) as HTMLElement;
        if (source instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = source.href;
        popup.document.head.appendChild(copy);
      }
      popup.document.body.className = "video-window-body";
      setEntries((old) => [...old.filter((entry) => entry.id !== tile.id), { id: tile.id, window: popup, document: popup.document }]);
    } catch { popup.close(); throw new Error(t("stage.popupFailed")); }
  };
  const windows = entries.map((entry) => {
    const tile = tiles.find((tile) => tile.id === entry.id);
    return tile && isOpen(entry) ? <VideoWindow key={entry.id} entry={entry} tile={tile} client={client} /> : null;
  });
  const restore = (id: string) => {
    entriesRef.current.find((entry) => entry.id === id)?.window.close();
    setEntries((old) => old.filter((entry) => entry.id !== id));
  };
  return { open, windows, restore, poppedIds: new Set(entries.filter(isOpen).map((entry) => entry.id)) };
}

function VideoWindow({ entry, tile, client }: { entry: Entry; tile: VideoTile; client: VoiceClient }) {
  const ref = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const target = useCallback(() => ref.current, []);
  const volume = client.getVideoAudioVolume(tile.id);
  const [error, setError] = useState("");
  useEffect(() => client.setVideoAudioHost(tile.id, audioRef.current!), [client, tile.id]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { entry.document.title = tile.name + " | Squorli"; }, [entry.document, tile.name]);
  const fullscreen = async () => {
    try { if (ref.current && !await toggleVideoFullscreen(ref.current)) setError(t("stage.fullscreenUnavailable")); }
    catch { setError(t("stage.fullscreenFailed")); }
  };
  return createPortal(<div ref={ref} className="video-window" tabIndex={0} aria-label={t("stage.popupVideoHint")}
    onDoubleClick={() => { void fullscreen(); }} onClick={() => { void client.startAudio(); }}
    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key.toLowerCase() === "f" || event.key === "Enter")) { event.preventDefault(); void fullscreen(); } }}>
    <TrackVideo tile={tile} />
    <div ref={audioRef} hidden />
    <div className="video-window-controls" onDoubleClick={(event) => event.stopPropagation()}>
      {volume !== null && <label className="video-window-volume">
        <Icon name="volume-2" />
        <span className="video-volume-label">{t("stage.popupVolume")}</span>
        <input type="range" min={0} max={1} step={0.01} value={volume} aria-label={t("stage.popupVolume")}
          onChange={(event) => client.setVideoAudioVolume(tile.id, Number(event.target.value))} />
        <output>{Math.round(volume * 100)}%</output>
      </label>}
      <FullscreenButton target={target} onError={setError} />
    </div>
    {error && <div className="video-window-notice" role="alert">{error}<button className="icon" title={t("common.dismiss")} onClick={() => setError("")}><Icon name="x" /></button></div>}
    {!client.state.canPlayback && <button className="video-window-notice" onClick={() => { void client.startAudio(); }}>{t("dock.unblockAudio")}</button>}
  </div>, entry.document.body);
}
