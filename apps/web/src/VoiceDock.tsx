import { Avatar } from "./Avatar";
import type { Channel } from "@squorli/protocol";
import { useEffect, useRef, useState } from "react";
import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "./voice/settings";
import { VoiceClient, type VoiceState } from "./voice/voiceClient";
import { Icon } from "./Icon";
import { BLUR_OPTIONS } from "./CameraPicker";
import { t, tOr } from "./i18n";

type Props = {
  client: VoiceClient;
  voice: VoiceState;
  channel: Channel | null;
  /** Name of the voice connection's server when a different server is currently displayed (multi-server client); otherwise null. */
  serverName: string | null;
  displayName: string;
  onLeave: () => Promise<void>;
  onOpenProfile: () => void;
  /** Show the stage (tiles) in the main area; null when it is already open. */
  onOpenStage: (() => void) | null;
  canStream: boolean;
  /** Report settings changes upwards (the stage needs the camera device/quality). */
  onSettings?: (s: VoiceSettings) => void;
  onToggleCamera: () => Promise<void>;
};

type SettingsTab = "voice" | "devices" | "camera";
const SETTINGS_TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "voice", label: t("settings.tab.voice"), icon: "mic" },
  { id: "devices", label: t("settings.tab.devices"), icon: "headphones" },
  { id: "camera", label: t("settings.tab.camera"), icon: "video" },
];

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/** Bottom area of the sidebar: your own name, voice status, mute, leave, settings. */
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

  // Push-to-talk: only while the tab has focus (a platform limit in the browser, PLAN 3.5).
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
        <div className={`dock-voice ${voice.status === "connected" ? "connected" : "connecting"}`}>
          <div className="dock-status">
            <span className="dock-connection-icon"><Icon name={voice.status === "connected" ? "volume-2" : "phone"} /></span>
            <div className="dock-connection-copy">
              <strong className="dock-connection-label" role="status">{voice.status === "connected" ? t("dock.connected") : tOr(`conn.${voice.status}`, voice.status)}</strong>
              <span className="dock-channel" title={serverName ? `${serverName} / ${channel?.name ?? "…"}` : channel?.name}>{channel?.name ?? "…"}</span>
              {serverName && <span className="dock-server" title={serverName}>{serverName}</span>}
            </div>
          </div>
          {onOpenStage && <button className="dock-stage" title={t("dock.stageHint")} onClick={onOpenStage}><Icon name="monitor" /><span>{t("dock.stage")}</span><Icon name="chevron-down" rotate={270} /></button>}
          <div className="dock-notices">
            {!voice.canPlayback && <button className="small warn" title={t("dock.unblockAudioHint")} onClick={() => client.startAudio()}>{t("dock.unblockAudio")}</button>}
            {voice.status === "connected" && voice.audioContext !== "running" && voice.audioContext !== "none" && <button className="small warn" title={t("dock.unblockMicHint")} onClick={() => client.prepareAudio()}>{t("dock.unblockMic")}</button>}
          </div>
          {voice.error && <p className="error small">{voice.error}</p>}
          {voice.notice && <p className="warn-box small">{voice.notice} <button className="icon" title={t("common.dismiss")} onClick={() => client.setNotice(null)}><Icon name="x" /></button></p>}
          <div className={`dock-input ${voice.micMuted ? "is-muted" : ""}`}>
            <span className="dock-input-label"><Icon name={voice.micMuted ? "mic-off" : "mic"} />{voice.micMuted ? t("voice.micMuted") : t("dock.micLevel")}</span>
            <div className="meter small-meter" aria-hidden="true">
              <div className="meter-fill" style={{ width: `${voice.micMuted ? 0 : levelPct}%` }} />
              {settings.mode === "vad" && !voice.micMuted && <div className="meter-threshold" style={{ left: `${thresholdPct}%` }} />}
            </div>
          </div>
          {/* quick actions of the voice connection: its own area above the name row */}
          <div className="dock-row dock-controls">
            <button aria-label={t("voice.mute")} aria-pressed={voice.micMuted} className={`icon ${voice.micMuted ? "danger" : ""}`} title={voice.micMuted ? (voice.deafened ? t("voice.unmuteAll") : t("voice.unmute")) : t("voice.mute")} onClick={() => client.setMuted(!voice.micMuted)}><Icon name={voice.micMuted ? "mic-off" : "mic"} /></button>
            <button aria-label={t("voice.deafen")} aria-pressed={voice.deafened} className={`icon ${voice.deafened ? "danger" : ""}`} title={voice.deafened ? t("voice.undeafen") : t("voice.deafen")} onClick={() => client.setDeafened(!voice.deafened)}><Icon name={voice.deafened ? "headphone-off" : "headphones"} /></button>
            {canStream && <button aria-label={t("voice.cameraOnBtn")} aria-pressed={voice.cameraOn} className={`icon ${voice.cameraOn ? "on" : ""}`} title={voice.cameraOn ? t("voice.cameraOff") : t("voice.cameraOnBtn")} onClick={() => { void onToggleCamera(); }}><Icon name={voice.cameraOn ? "video" : "video-off"} /></button>}
            <button aria-label={t("voice.leave")} className="icon hangup" title={t("voice.leave")} onClick={() => onLeave()}><Icon name="phone" rotate={135} /></button>
          </div>
        </div>
      )}
      {!joined && voice.error && <p className="error small">{voice.error}</p>}
      <div className="dock-row">
        <button className="dock-name" onClick={onOpenProfile} title={t("dock.changeName")}><Avatar name={displayName} /><span className="dock-identity"><strong>{displayName}</strong><small>{t("profile.tab.profile")}</small></span></button>
        <button className="icon" title={t("dock.settings")} onClick={() => setShowSettings(true)}><Icon name="settings" /></button>
      </div>

      {showSettings && (
        <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}>
        <div className="modal settings-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head"><h2>{t("settings.title")}</h2><span className="spacer" /><button className="icon" title={t("common.close")} onClick={() => setShowSettings(false)}><Icon name="x" /></button></header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {SETTINGS_TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}><Icon name={t.icon} /> {t.label}</button>
            ))}
          </nav>
          <div className="settings-body stack">
            {tab === "voice" && (
              <>
                <h3>{t("settings.tab.voice")}</h3>
                <div className="row">
                  <label className="check"><input type="radio" checked={settings.mode === "vad"} onChange={() => update({ mode: "vad" })} /> {t("settings.vad")}</label>
                  <label className="check"><input type="radio" checked={settings.mode === "ptt"} onChange={() => update({ mode: "ptt" })} /> {t("settings.ptt")}</label>
                </div>
                {settings.mode === "vad" ? (
                  <>
                    <label className="stack">
                      {t("settings.threshold")}
                      <input type="range" min={0.005} max={0.25} step={0.005} value={settings.vadThreshold} onChange={(e) => update({ vadThreshold: Number(e.target.value) })} />
                    </label>
                    {joined && (
                      <div className="meter" title={t("dock.micLevel")}>
                        <div className="meter-fill" style={{ width: `${levelPct}%` }} />
                        <div className="meter-threshold" style={{ left: `${thresholdPct}%` }} />
                      </div>
                    )}
                    <label className="stack">
                      {t("settings.hangover", { ms: settings.vadHangoverMs })}
                      <input type="range" min={100} max={1500} step={50} value={settings.vadHangoverMs} onChange={(e) => update({ vadHangoverMs: Number(e.target.value) })} />
                      <span className="muted small">{t("settings.hangoverHint")}</span>
                    </label>
                  </>
                ) : (
                  <div className="stack">
                    <span>{t("settings.key")} <kbd>{settings.pttKey}</kbd> <button className="secondary small" onClick={() => setCapturingKey(true)}>{capturingKey ? t("settings.pressKey") : t("settings.change")}</button></span>
                    <span className="muted small">{t("settings.pttHint")}</span>
                  </div>
                )}
              </>
            )}

            {tab === "devices" && (
              <>
                <h3>{t("settings.input")}</h3>
                <label className="stack">
                  {t("settings.microphone")}
                  <select value={voice.inputDeviceId ?? settings.inputDeviceId ?? ""}
                    onChange={(e) => { const id = e.target.value || null; update({ inputDeviceId: id }); void client.setInputDevice(id); }}>
                    <option value="">{t("settings.default")}</option>
                    {devices.inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                </label>
                <h3>{t("settings.output")}</h3>
                <label className="stack">
                  {t("settings.voiceOut")}
                  <select value={settings.outputDeviceId ?? ""} disabled={devices.outputs.length === 0}
                    onChange={(e) => { const id = e.target.value || null; update({ outputDeviceId: id }); if (id) void client.setOutputDevice(id); }}>
                    <option value="">{t("settings.default")}</option>
                    {devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                  {devices.outputs.length === 0 && <span className="muted small">{t("settings.outputChromium")}</span>}
                </label>
                <label className="stack">
                  {t("settings.screenAudio")}
                  <select value={settings.screenOutputDeviceId ?? ""} disabled={devices.outputs.length === 0}
                    onChange={(e) => { const id = e.target.value || null; update({ screenOutputDeviceId: id }); void client.setScreenOutputDevice(id); }}>
                    <option value="">{t("settings.sameAsVoice")}</option>
                    {devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                  <span className="muted small">{t("settings.screenAudioHint")}</span>
                </label>
                {!joined && <span className="muted small">{t("settings.deviceNamesHint")}</span>}
              </>
            )}

            {tab === "camera" && (
              <>
                <h3>{t("settings.device")}</h3>
                <label className="stack">
                  {t("settings.tab.camera")}
                  <select value={settings.cameraDeviceId ?? ""}
                    onChange={(e) => { const id = e.target.value || null; update({ cameraDeviceId: id }); void client.setCameraDevice(id); }}>
                    <option value="">{t("settings.default")}</option>
                    {devices.cameras.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                  <span className="muted small">{t("settings.cameraPreselect")}</span>
                </label>
                <h3>{t("settings.picture")}</h3>
                <label className="stack">
                  {t("settings.quality")}
                  <select value={settings.cameraQuality} onChange={(e) => { const q = e.target.value as "360p" | "720p"; update({ cameraQuality: q }); if (voice.cameraOn) void client.setCameraEnabled(true, undefined, q); }}>
                    <option value="720p">{t("settings.q720")}</option>
                    <option value="360p">{t("settings.q360")}</option>
                  </select>
                  <span className="muted small">{t("settings.qualityHint")}</span>
                </label>
                <label className="stack">
                  {t("settings.background")}
                  <select value={settings.cameraBlur} disabled={!VoiceClient.supportsBlur()}
                    onChange={(e) => { const v = Number(e.target.value); update({ cameraBlur: v }); if (voice.cameraOn) void client.setCameraBlur(v); }}>
                    {BLUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span className="muted small">{VoiceClient.supportsBlur() ? t("settings.blurHint") : t("settings.noBlur")}</span>
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
