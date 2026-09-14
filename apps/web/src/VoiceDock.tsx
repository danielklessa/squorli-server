import type { Channel } from "@squorli/protocol";
import { useEffect, useRef, useState } from "react";
import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "./voice/settings";
import { VoiceClient, type VoiceState } from "./voice/voiceClient";
import { Icon } from "./Icon";
import { BLUR_OPTIONS } from "./CameraPicker";

type Props = {
  client: VoiceClient;
  voice: VoiceState;
  channel: Channel | null;
  /** Name des Servers der Sprachverbindung, wenn gerade ein anderer Server angezeigt wird (Multi-Server-Client); sonst null. */
  serverName: string | null;
  displayName: string;
  onLeave: () => Promise<void>;
  onOpenProfile: () => void;
  /** Buehne (Kacheln) im Hauptbereich zeigen; null, wenn sie schon offen ist. */
  onOpenStage: (() => void) | null;
  canStream: boolean;
  /** Aenderungen an den Einstellungen nach oben melden (Kamera-Geraet/Qualitaet braucht die Buehne). */
  onSettings?: (s: VoiceSettings) => void;
  onToggleCamera: () => Promise<void>;
};

type SettingsTab = "voice" | "devices" | "camera";
const SETTINGS_TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "voice", label: "Sprechen", icon: "mic" },
  { id: "devices", label: "Geräte", icon: "headphones" },
  { id: "camera", label: "Kamera", icon: "video" },
];

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/** Unterer Bereich der Seitenleiste: eigener Name, Sprachstatus, Stumm, Verlassen, Einstellungen. */
export function VoiceDock({ client, voice, channel, serverName, displayName, onLeave, onOpenProfile, onOpenStage, canStream, onSettings, onToggleCamera }: Props) {
  const [settings, setSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("voice");
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({ inputs: [], outputs: [], cameras: [] });
  const [capturingKey, setCapturingKey] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const joined = voice.status !== "disconnected";

  function update(patch: Partial<VoiceSettings>) {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next); saveVoiceSettings(next); onSettings?.(next);
    if (patch.mode) client.setMode(patch.mode);
    if (patch.vadThreshold !== undefined) client.setThreshold(patch.vadThreshold);
    if (patch.vadHangoverMs !== undefined) client.setHangover(patch.vadHangoverMs);
  }

  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowSettings(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

  useEffect(() => {
    if (!showSettings) return;
    let alive = true;
    const load = () => VoiceClient.listDevices().then((d) => { if (alive) setDevices(d); }).catch(() => {});
    void load();
    navigator.mediaDevices?.addEventListener("devicechange", load);
    return () => { alive = false; navigator.mediaDevices?.removeEventListener("devicechange", load); };
  }, [showSettings, joined]);

  // Push-to-Talk: nur solange der Tab den Fokus hat (Plattformgrenze im Browser, PLAN 3.5).
  useEffect(() => {
    if (!joined || settings.mode !== "ptt") { client.setPttHeld(false); return; }
    const down = (e: KeyboardEvent) => {
      if (capturingKey || isTypingTarget(e.target) || e.code !== settingsRef.current.pttKey) return;
      e.preventDefault();
      if (!e.repeat) client.setPttHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === settingsRef.current.pttKey) client.setPttHeld(false); };
    const release = () => client.setPttHeld(false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", release);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", release); release(); };
  }, [joined, settings.mode, capturingKey, client]);

  useEffect(() => {
    if (!capturingKey) return;
    const handler = (e: KeyboardEvent) => { e.preventDefault(); update({ pttKey: e.code }); setCapturingKey(false); };
    window.addEventListener("keydown", handler, { once: true });
    return () => window.removeEventListener("keydown", handler);
  }, [capturingKey]);

  const levelPct = Math.min(100, Math.round(voice.level * 400));
  const thresholdPct = Math.min(100, Math.round(settings.vadThreshold * 400));

  return (
    <div className="dock">
      {joined && (
        <div className="dock-voice">
          <div className="dock-status">
            <span className={voice.status === "connected" ? "ok" : "warn"}>{voice.status === "connected" ? "Sprache verbunden" : voice.status}</span>
            <span className="muted"> · <Icon name="volume-2" /> {serverName ? `${serverName} / ` : ""}{channel?.name ?? "…"}</span>
            {!voice.canPlayback && <button className="small warn" title="Der Browser blockiert die Wiedergabe bis zu einem Klick" onClick={() => client.startAudio()}>Ton freigeben</button>}
            {voice.status === "connected" && voice.audioContext !== "running" && voice.audioContext !== "none" && <button className="small warn" title="Der Browser hat den Audio-Kontext angehalten; Klick gibt Mikrofon und Sprecheranzeige frei" onClick={() => client.prepareAudio()}>Mikrofon freigeben</button>}
            {onOpenStage && <button className="small secondary" title="Kacheln und Bildschirmfreigaben anzeigen" onClick={onOpenStage}>Ansicht</button>}
          </div>
          {voice.error && <p className="error small">{voice.error}</p>}
          {voice.notice && <p className="warn-box small">{voice.notice} <button className="icon" title="Ausblenden" onClick={() => client.setNotice(null)}><Icon name="x" /></button></p>}
          <div className="meter small-meter" title="Mikrofonpegel">
            <div className="meter-fill" style={{ width: `${levelPct}%` }} />
            {settings.mode === "vad" && <div className="meter-threshold" style={{ left: `${thresholdPct}%` }} />}
          </div>
          {/* Schnellzugriffe der Sprachverbindung: eigener Bereich oberhalb der Namenszeile */}
          <div className="dock-row dock-controls">
            <button className={`icon ${voice.micMuted ? "danger" : ""}`} title={voice.micMuted ? (voice.deafened ? "Ton und Mikrofon wieder an" : "Mikrofon wieder an") : "Mikrofon stummschalten"} onClick={() => client.setMuted(!voice.micMuted)}><Icon name={voice.micMuted ? "mic-off" : "mic"} /></button>
            <button className={`icon ${voice.deafened ? "danger" : ""}`} title={voice.deafened ? "Ton wieder an" : "Ton aus (schaltet auch das Mikrofon stumm)"} onClick={() => client.setDeafened(!voice.deafened)}><Icon name={voice.deafened ? "headphone-off" : "headphones"} /></button>
            {canStream && <button className={`icon ${voice.cameraOn ? "on" : ""}`} title={voice.cameraOn ? "Kamera aus" : "Kamera an"} onClick={() => { void onToggleCamera(); }}><Icon name={voice.cameraOn ? "video" : "video-off"} /></button>}
            <span className="spacer" />
            <button className="icon hangup" title="Sprachkanal verlassen (auflegen)" onClick={() => onLeave()}><Icon name="phone" rotate={135} /></button>
          </div>
        </div>
      )}
      {!joined && voice.error && <p className="error small">{voice.error}</p>}
      <div className="dock-row">
        <button className="dock-name" onClick={onOpenProfile} title="Anzeigename ändern">{displayName}</button>
        <button className="icon" title="Spracheinstellungen" onClick={() => setShowSettings(true)}><Icon name="settings" /></button>
      </div>

      {showSettings && (
        <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}>
        <div className="modal settings-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head"><h2>Einstellungen</h2><span className="spacer" /><button className="icon" title="Schließen" onClick={() => setShowSettings(false)}><Icon name="x" /></button></header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {SETTINGS_TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}><Icon name={t.icon} /> {t.label}</button>
            ))}
          </nav>
          <div className="settings-body stack">
            {tab === "voice" && (
              <>
                <h3>Sprechen</h3>
                <div className="row">
                  <label className="check"><input type="radio" checked={settings.mode === "vad"} onChange={() => update({ mode: "vad" })} /> Sprachaktivierung</label>
                  <label className="check"><input type="radio" checked={settings.mode === "ptt"} onChange={() => update({ mode: "ptt" })} /> Push-to-Talk</label>
                </div>
                {settings.mode === "vad" ? (
                  <>
                    <label className="stack">
                      Schwelle
                      <input type="range" min={0.005} max={0.25} step={0.005} value={settings.vadThreshold} onChange={(e) => update({ vadThreshold: Number(e.target.value) })} />
                    </label>
                    {joined && (
                      <div className="meter" title="Mikrofonpegel">
                        <div className="meter-fill" style={{ width: `${levelPct}%` }} />
                        <div className="meter-threshold" style={{ left: `${thresholdPct}%` }} />
                      </div>
                    )}
                    <label className="stack">
                      Nachlauf ({settings.vadHangoverMs} ms)
                      <input type="range" min={100} max={1500} step={50} value={settings.vadHangoverMs} onChange={(e) => update({ vadHangoverMs: Number(e.target.value) })} />
                      <span className="muted small">Wie lange das Mikrofon nach dem letzten Wort offen bleibt, damit Wortenden nicht abgeschnitten werden.</span>
                    </label>
                  </>
                ) : (
                  <div className="stack">
                    <span>Taste: <kbd>{settings.pttKey}</kbd> <button className="secondary small" onClick={() => setCapturingKey(true)}>{capturingKey ? "Taste drücken …" : "ändern"}</button></span>
                    <span className="muted small">Im Browser nur, solange dieser Tab den Fokus hat. Globales Tastenkürzel: Desktop-Client (M4).</span>
                  </div>
                )}
              </>
            )}

            {tab === "devices" && (
              <>
                <h3>Eingabe</h3>
                <label className="stack">
                  Mikrofon
                  <select value={voice.inputDeviceId ?? settings.inputDeviceId ?? ""}
                    onChange={(e) => { const id = e.target.value || null; update({ inputDeviceId: id }); void client.setInputDevice(id); }}>
                    <option value="">Standard</option>
                    {devices.inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                </label>
                <h3>Ausgabe</h3>
                <label className="stack">
                  Sprache
                  <select value={settings.outputDeviceId ?? ""} disabled={devices.outputs.length === 0}
                    onChange={(e) => { const id = e.target.value || null; update({ outputDeviceId: id }); if (id) void client.setOutputDevice(id); }}>
                    <option value="">Standard</option>
                    {devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                  {devices.outputs.length === 0 && <span className="muted small">Ausgabegerät wählen: nur Chromium.</span>}
                </label>
                <label className="stack">
                  Bildschirm-Ton
                  <select value={settings.screenOutputDeviceId ?? ""} disabled={devices.outputs.length === 0}
                    onChange={(e) => { const id = e.target.value || null; update({ screenOutputDeviceId: id }); void client.setScreenOutputDevice(id); }}>
                    <option value="">Wie Sprache</option>
                    {devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                  <span className="muted small">Ton geteilter Bildschirme getrennt ausgeben, z. B. auf die Lautsprecher statt ins Headset.</span>
                </label>
                {!joined && <span className="muted small">Geräte-Namen erscheinen nach der ersten Mikrofonfreigabe.</span>}
              </>
            )}

            {tab === "camera" && (
              <>
                <h3>Gerät</h3>
                <label className="stack">
                  Kamera
                  <select value={settings.cameraDeviceId ?? ""}
                    onChange={(e) => { const id = e.target.value || null; update({ cameraDeviceId: id }); void client.setCameraDevice(id); }}>
                    <option value="">Standard</option>
                    {devices.cameras.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                  <span className="muted small">Vorauswahl. Beim Einschalten fragt der Client nach Kamera und Hintergrund.</span>
                </label>
                <h3>Bild</h3>
                <label className="stack">
                  Qualität
                  <select value={settings.cameraQuality} onChange={(e) => { const q = e.target.value as "360p" | "720p"; update({ cameraQuality: q }); if (voice.cameraOn) void client.setCameraEnabled(true, undefined, q); }}>
                    <option value="720p">720p (Standard, bis ~1,7 Mbit/s)</option>
                    <option value="360p">360p (schwache Leitung, bis ~0,4 Mbit/s)</option>
                  </select>
                  <span className="muted small">Empfänger bekommen automatisch die Stufe, die zu ihrer Kachelgröße passt (Simulcast).</span>
                </label>
                <label className="stack">
                  Hintergrund
                  <select value={settings.cameraBlur} disabled={!VoiceClient.supportsBlur()}
                    onChange={(e) => { const v = Number(e.target.value); update({ cameraBlur: v }); if (voice.cameraOn) void client.setCameraBlur(v); }}>
                    {BLUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span className="muted small">{VoiceClient.supportsBlur() ? "Rechnet im Browser (MediaPipe); kostet etwas CPU. Modell wird beim ersten Einschalten geladen." : "Dieser Browser unterstützt keine Hintergrund-Effekte."}</span>
                </label>
              </>
            )}
          </div>
        </div>
        </div>
        </div>
      )}
    </div>
  );
}

export { loadVoiceSettings };
