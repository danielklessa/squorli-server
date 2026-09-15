import { BackgroundBlur, type BackgroundProcessorWrapper } from "@livekit/track-processors";
import { VideoPresets, createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { VoiceClient } from "./voice/voiceClient";
import { t } from "./i18n";

type Props = {
  cameras: MediaDeviceInfo[];
  /** Preselection (last used camera), otherwise the first one. */
  initial: string | null;
  /** Preselected background blur (0 = off). */
  initialBlur: number;
  onPick: (deviceId: string, blur: number) => void;
  onCancel: () => void;
};

export const BLUR_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: t("blur.normal") },
  { value: 10, label: t("blur.light") },
  { value: 20, label: t("blur.strong") },
];

/**
 * Camera picker at switch-on time (as the user specified: always ask when there are several cameras), including the background.
 * Own modal with a live preview; the preview is an unpublished LiveKit track so the blur
 * (BackgroundBlur processor) looks exactly as it later will in the channel. No browser dialog.
 */
export function CameraPicker({ cameras, initial, initialBlur, onPick, onCancel }: Props) {
  const [selected, setSelected] = useState(() => (initial && cameras.some((c) => c.deviceId === initial) ? initial : cameras[0]?.deviceId ?? ""));
  const [blur, setBlur] = useState(VoiceClient.supportsBlur() ? initialBlur : 0);
  const [err, setErr] = useState<string | null>(null);
  const [track, setTrack] = useState<LocalVideoTrack | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const processor = useRef<BackgroundProcessorWrapper | null>(null);
  const canBlur = VoiceClient.supportsBlur();

  // Preview of the highlighted camera; release the camera again when switching and when closing.
  useEffect(() => {
    let alive = true;
    let created: LocalVideoTrack | null = null;
    setErr(null);
    createLocalVideoTrack({ deviceId: selected, resolution: VideoPresets.h360.resolution })
      .then((t) => { if (!alive) { t.stop(); return; } created = t; setTrack(t); if (videoRef.current) t.attach(videoRef.current); })
      .catch((e: unknown) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => {
      alive = false;
      processor.current = null;
      if (created) { created.detach(); void created.stopProcessor().catch(() => {}); created.stop(); }
      setTrack(null);
    };
  }, [selected]);

  // Apply the blur to the preview (the same processor as in the channel).
  useEffect(() => {
    if (!track || !canBlur) return;
    let cancelled = false;
    (async () => {
      try {
        if (blur <= 0) { if (processor.current) { await track.stopProcessor(); processor.current = null; } }
        else if (processor.current) await processor.current.switchTo({ mode: "background-blur", blurRadius: blur });
        else { const p = BackgroundBlur(blur); await track.setProcessor(p); if (!cancelled) processor.current = p; }
      } catch (e) { if (!cancelled) setErr(t("camera.bgError", { err: e instanceof Error ? e.message : String(e) })); }
    })();
    return () => { cancelled = true; };
  }, [track, blur, canBlur]);

  // Release the preview first, then switch on: otherwise the camera is grabbed twice.
  const pick = () => { if (!selected) return; setTrack(null); onPick(selected, blur); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter" && selected) pick(); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }); // deliberately without dependencies: always reads the current state

  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={onCancel}>
      <div className="modal dialog camera-picker" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t("camera.title")}</h2>
        <div className="camera-preview">
          <video ref={videoRef} autoPlay playsInline muted className="mirror" />
          {err && <p className="error small">{err}</p>}
        </div>
        <h3>{t("camera.camera")}</h3>
        <ul className="camera-list">
          {cameras.map((c, i) => (
            <li key={c.deviceId}>
              <button className={`camera-option ${selected === c.deviceId ? "active" : ""}`} onClick={() => setSelected(c.deviceId)} onDoubleClick={pick}>
                <Icon name="video" />{c.label || t("camera.n", { n: i + 1 })}
              </button>
            </li>
          ))}
        </ul>
        <h3>{t("camera.background")}</h3>
        {canBlur ? (
          <div className="seg wide">
            {BLUR_OPTIONS.map((o) => <button key={o.value} className={blur === o.value ? "active" : ""} onClick={() => setBlur(o.value)}>{o.label}</button>)}
          </div>
        ) : <p className="muted small">{t("camera.noBlur")}</p>}
        <div className="dialog-actions">
          <button className="secondary" onClick={onCancel}>{t("common.cancel")}</button>
          <button disabled={!selected} onClick={pick}>{t("camera.title")}</button>
        </div>
      </div>
    </div>
  );
}
