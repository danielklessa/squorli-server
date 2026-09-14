import { BackgroundBlur, type BackgroundProcessorWrapper } from "@livekit/track-processors";
import { VideoPresets, createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { VoiceClient } from "./voice/voiceClient";

type Props = {
  cameras: MediaDeviceInfo[];
  /** Vorauswahl (zuletzt benutzte Kamera), sonst die erste. */
  initial: string | null;
  /** Vorauswahl der Hintergrund-Unschaerfe (0 = aus). */
  initialBlur: number;
  onPick: (deviceId: string, blur: number) => void;
  onCancel: () => void;
};

export const BLUR_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Normal" },
  { value: 10, label: "Leicht unscharf" },
  { value: 20, label: "Stark unscharf" },
];

/**
 * Kamera-Auswahl beim Einschalten (Vorgabe des Nutzers: bei mehreren Kameras immer fragen), inklusive Hintergrund.
 * Eigenes Modal mit Live-Vorschau; die Vorschau ist ein unpublizierter LiveKit-Track, damit die Unschaerfe
 * (BackgroundBlur-Prozessor) genauso aussieht wie spaeter im Kanal. Kein Browser-Dialog.
 */
export function CameraPicker({ cameras, initial, initialBlur, onPick, onCancel }: Props) {
  const [selected, setSelected] = useState(() => (initial && cameras.some((c) => c.deviceId === initial) ? initial : cameras[0]?.deviceId ?? ""));
  const [blur, setBlur] = useState(VoiceClient.supportsBlur() ? initialBlur : 0);
  const [err, setErr] = useState<string | null>(null);
  const [track, setTrack] = useState<LocalVideoTrack | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const processor = useRef<BackgroundProcessorWrapper | null>(null);
  const canBlur = VoiceClient.supportsBlur();

  // Vorschau der markierten Kamera; beim Wechsel und beim Schliessen die Kamera wieder freigeben.
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

  // Unschaerfe auf die Vorschau anwenden (derselbe Prozessor wie im Kanal).
  useEffect(() => {
    if (!track || !canBlur) return;
    let cancelled = false;
    (async () => {
      try {
        if (blur <= 0) { if (processor.current) { await track.stopProcessor(); processor.current = null; } }
        else if (processor.current) await processor.current.switchTo({ mode: "background-blur", blurRadius: blur });
        else { const p = BackgroundBlur(blur); await track.setProcessor(p); if (!cancelled) processor.current = p; }
      } catch (e) { if (!cancelled) setErr(`Hintergrund: ${e instanceof Error ? e.message : String(e)}`); }
    })();
    return () => { cancelled = true; };
  }, [track, blur, canBlur]);

  // Erst die Vorschau freigeben, dann einschalten: sonst greift die Kamera doppelt.
  const pick = () => { if (!selected) return; setTrack(null); onPick(selected, blur); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter" && selected) pick(); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }); // absichtlich ohne Abhaengigkeiten: greift immer auf den aktuellen Stand zu

  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={onCancel}>
      <div className="modal dialog camera-picker" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Kamera einschalten</h2>
        <div className="camera-preview">
          <video ref={videoRef} autoPlay playsInline muted className="mirror" />
          {err && <p className="error small">{err}</p>}
        </div>
        <h3>Kamera</h3>
        <ul className="camera-list">
          {cameras.map((c, i) => (
            <li key={c.deviceId}>
              <button className={`camera-option ${selected === c.deviceId ? "active" : ""}`} onClick={() => setSelected(c.deviceId)} onDoubleClick={pick}>
                <Icon name="video" />{c.label || `Kamera ${i + 1}`}
              </button>
            </li>
          ))}
        </ul>
        <h3>Hintergrund</h3>
        {canBlur ? (
          <div className="seg wide">
            {BLUR_OPTIONS.map((o) => <button key={o.value} className={blur === o.value ? "active" : ""} onClick={() => setBlur(o.value)}>{o.label}</button>)}
          </div>
        ) : <p className="muted small">Dieser Browser unterstützt keine Hintergrund-Effekte (Chrome, Edge oder Brave nötig).</p>}
        <div className="dialog-actions">
          <button className="secondary" onClick={onCancel}>Abbrechen</button>
          <button disabled={!selected} onClick={pick}>Kamera einschalten</button>
        </div>
      </div>
    </div>
  );
}
