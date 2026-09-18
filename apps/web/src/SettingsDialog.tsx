import { Avatar } from "./Avatar";
import type { DirectoryAccount, Me, SessionInfo } from "@squorli/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerApi } from "./api";
import { BLUR_OPTIONS } from "./CameraPicker";
import { askConfirm } from "./dialogs";
import { Icon } from "./Icon";
import { LicensesTab } from "./LicensesTab";
import { LOCALES, fmtDateTime, localePreference, t, type LocalePreference } from "./i18n";
import { activity } from "./activity";
import { platform, type WindowAppearance } from "./platform";
import { idleDetectionSupported, idleDetectionWanted, setIdleDetection } from "./idleDetection";
import { saveVoiceSettings, type VoiceSettings } from "./voice/settings";
import { SOUND_CUES, type SoundCue, type SoundSettings } from "./voice/sounds";
import { useVoiceSettings } from "./voice/useVoiceSettings";
import { VoiceClient, type VoiceState } from "./voice/voiceClient";

export type SettingsTab = "profile" | "view" | "voice" | "audio" | "camera" | "sounds" | "sessions" | "account" | "licenses";
const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "profile", label: t("settings.tab.profile"), icon: "user" },
  { id: "view", label: t("settings.tab.view"), icon: "languages" },
  { id: "voice", label: t("settings.tab.voice"), icon: "mic" },
  { id: "audio", label: t("settings.tab.audio"), icon: "headphones" },
  { id: "camera", label: t("settings.tab.camera"), icon: "video" },
  { id: "sounds", label: t("settings.tab.sounds"), icon: "bell" },
  { id: "sessions", label: t("settings.tab.sessions"), icon: "monitor-smartphone" },
  { id: "account", label: t("settings.tab.account"), icon: "key-round" },
  { id: "licenses", label: t("settings.tab.licenses"), icon: "scale" },
];
/** Categories whose content follows the directory account (everything except the device selection, sessions and the account itself). */
const SYNCED: readonly SettingsTab[] = ["view", "voice", "camera", "sounds"];

/** Label per cue, in the order they are offered in the settings. */
const SOUND_LABELS: Record<SoundCue, string> = {
  selfJoin: t("settings.soundSelfJoin"),
  selfLeave: t("settings.soundSelfLeave"),
  peerJoin: t("settings.soundPeerJoin"),
  peerLeave: t("settings.soundPeerLeave"),
};

const fmt = fmtDateTime;

/**
 * All user and profile settings in one categorized modal (categories on the left), opened by the gear next to your name:
 * profile (display name on this server; with a directory account also the global name), view (language, speaker view),
 * speaking, audio devices, camera, sounds, sessions (devices signed in on this server, M6c), account (handle, key, link to
 * the directory's account page, sign out, discard identity) and licenses (our own and the third-party notices, LicensesTab.tsx). With a directory account everything except the device selection
 * is stored there (store.ts pushes every change); sessions and the name on this server belong to the server shown.
 */
export function SettingsDialog({ api, me, publicKey, displayName, directoryUrl, directoryAccount, serverDomain, clientVersion, syncError, client, voice, initialTab, onSaveServerName, onSaveGlobalName, onSetLocale, onCapturingKey, onClose, onLogout, onForget }: {
  /** The server on screen and who you are there; null = none is shown (client without a home server): the dialog then has
   *  no profile and no sessions, which belong to a server, and the account page names the directory account and `publicKey`. */
  api: ServerApi | null; me: Me | null; publicKey: string | null;
  /** Your name as the server shows it right now (member list); the preview falls back to it. */
  displayName: string;
  directoryUrl: string | null; directoryAccount: DirectoryAccount | null | undefined; serverDomain: string | null;
  /** Version of the server that serves this client (from its /api/health), shown with the licenses. */
  clientVersion: string | null;
  /** Last failure while saving the settings in the account; null = none. */
  syncError: string | null;
  client: VoiceClient; voice: VoiceState; initialTab?: SettingsTab;
  onSaveServerName: (displayName: string | null) => Promise<void>;
  onSaveGlobalName: (displayName: string | null) => Promise<void>;
  onSetLocale: (pref: LocalePreference) => Promise<void>;
  /** While the push-to-talk key is being captured the dock's push-to-talk listener has to stay quiet. */
  onCapturingKey: (capturing: boolean) => void;
  onClose: () => void; onLogout: () => void; onForget: () => void;
}) {
  const settings = useVoiceSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onServer = !!api && !!me;
  const tabs = TABS.filter((entry) => onServer || (entry.id !== "profile" && entry.id !== "sessions"));
  const [tab, setTab] = useState<SettingsTab>(() => { const wanted = initialTab ?? "profile"; return tabs.some((entry) => entry.id === wanted) ? wanted : "view"; });
  const [name, setName] = useState(me?.displayName ?? "");
  const handle = me?.handle ?? directoryAccount?.handle ?? null;
  // Desktop app: window background (mica/acrylic + opacity); null in the browser and where the system offers no material.
  const windowLook = platform.window.appearance;
  const [look, setLook] = useState<WindowAppearance | null>(() => windowLook?.get() ?? null);
  const changeLook = (next: WindowAppearance) => { setLook(next); void windowLook?.set(next).then(() => setLook(windowLook.get())); };
  const [globalName, setGlobalName] = useState(directoryAccount?.displayName ?? "");
  // The global name arrives with the signed account status, possibly after the dialog opened: follow it until the user edits the field
  // (an empty field saved over a name that had not arrived yet would delete it).
  const globalTouched = useRef(false);
  useEffect(() => { if (!globalTouched.current) setGlobalName(directoryAccount?.displayName ?? ""); }, [directoryAccount?.displayName]);
  // With a directory account: the local name is the per-server entry in the directory, empty = the global name.
  const withDirectory = !!directoryAccount && !!serverDomain;
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** AFK detection across the whole system (Idle Detection API): per browser, because the permission is the browser's. */
  const [idleDetect, setIdleDetect] = useState(() => idleDetectionSupported() && idleDetectionWanted());
  const [idleDenied, setIdleDenied] = useState(false);
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({ inputs: [], outputs: [], cameras: [] });
  const [capturingKey, setCapturingKey] = useState(false);
  const dirHost = directoryUrl ? new URL(directoryUrl).host : null;
  const joined = voice.status !== "disconnected";
  const inAccount = !!directoryUrl && !!directoryAccount;

  const update = (patch: Partial<VoiceSettings>) => saveVoiceSettings({ ...settingsRef.current, ...patch });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !capturingKey) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, capturingKey]);

  useEffect(() => {
    let alive = true;
    const load = () => VoiceClient.listDevices().then((d) => { if (alive) setDevices(d); }).catch(() => {});
    void load();
    navigator.mediaDevices?.addEventListener("devicechange", load);
    return () => { alive = false; navigator.mediaDevices?.removeEventListener("devicechange", load); };
  }, [joined]);

  useEffect(() => {
    onCapturingKey(capturingKey);
    if (!capturingKey) return;
    const handler = (e: KeyboardEvent) => { e.preventDefault(); update({ pttKey: e.code }); setCapturingKey(false); };
    window.addEventListener("keydown", handler, { once: true });
    return () => { window.removeEventListener("keydown", handler); onCapturingKey(false); };
  }, [capturingKey]);

  const loadSessions = useCallback(async () => {
    if (!api) return;
    try { setSessions(await api.getSessions()); setErr(null); } catch (e) { setErr(String(e)); }
  }, [api]);
  useEffect(() => { if (tab === "sessions") void loadSessions(); }, [tab, loadSessions]);
  useEffect(() => { setErr(null); setSaved(false); }, [tab]);

  async function saveNames() {
    const local = name.trim() || null;
    const global = globalName.trim() || null;
    setBusy(true); setSaved(false);
    try {
      // The global name first: the name on this server is stored only as a deviation from it.
      if (withDirectory && global !== (directoryAccount?.displayName ?? null)) await onSaveGlobalName(global);
      await onSaveServerName(local);
      setErr(null); setSaved(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function changeLocale(pref: LocalePreference) {
    setBusy(true);
    try { await onSetLocale(pref); } finally { setBusy(false); }
  }
  async function revoke(s: SessionInfo) {
    const ok = await askConfirm({ title: t("profile.revokeDeviceTitle"), text: t("profile.revokeDeviceText", { label: s.label ?? t("profile.thisDevice"), date: fmt(s.createdAt) }), confirmLabel: t("profile.signOut"), danger: true });
    if (!ok) return;
    setBusy(true);
    try { await api?.revokeSession(s.id); await loadSessions(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function revokeOthers() {
    const ok = await askConfirm({ title: t("profile.revokeOthersTitle"), text: t("profile.revokeOthersText"), confirmLabel: t("profile.signOutAll"), danger: true });
    if (!ok) return;
    setBusy(true);
    try { await api?.revokeOtherSessions(); await loadSessions(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function forget() {
    const ok = await askConfirm({ title: t("profile.forgetTitle"), text: t("profile.forgetText"), confirmLabel: t("profile.forget"), danger: true });
    if (ok) onForget();
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;
  const levelPct = Math.min(100, Math.round(voice.level * 400));
  const thresholdPct = Math.min(100, Math.round(settings.vadThreshold * 400));
  const shownName = name.trim() || (withDirectory ? globalName.trim() : "") || displayName;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("settings.title")}</h2>
          <span className="spacer" />
          <button className="icon" title={t("common.close")} onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {tabs.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}><Icon name={t.icon} /> {t.label}</button>)}
          </nav>
          <div className="settings-body stack">
            {err && <p className="error">{err}</p>}

            {tab === "profile" && onServer && (
              <>
                <div className="profile-preview"><Avatar name={shownName || "?"} size="large" /><div><strong>{shownName}</strong>{handle && <div className="muted small">@{handle}</div>}</div></div>
                <h3>{t("profile.nameHere")}</h3>
                <input value={name} maxLength={32} autoFocus onChange={(e) => { setName(e.target.value); setSaved(false); }} onKeyDown={(e) => { if (e.key === "Enter") void saveNames(); }} />
                <span className="muted small">{withDirectory ? t("profile.nameHereHintDir") : t("profile.nameHereHint")}</span>
                {withDirectory && (
                  <>
                    <h3>{t("profile.nameGlobal")}</h3>
                    <input value={globalName} maxLength={32} onChange={(e) => { globalTouched.current = true; setGlobalName(e.target.value); setSaved(false); }} onKeyDown={(e) => { if (e.key === "Enter") void saveNames(); }} />
                    <span className="muted small">{t("profile.nameGlobalHint", { host: dirHost ?? "", handle: directoryAccount?.handle ?? "" })}</span>
                  </>
                )}
                <div className="row"><button disabled={busy} onClick={() => void saveNames()}>{t("common.save")}</button>{saved && <span className="muted small" role="status">{t("settings.saved")}</span>}</div>
              </>
            )}

            {tab === "view" && (
              <>
                <h3>{t("common.language")}</h3>
                <select value={localePreference()} disabled={busy} onChange={(e) => void changeLocale(e.target.value as LocalePreference)}>
                  <option value="auto">{t("lang.auto")}</option>
                  {LOCALES.map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
                </select>
                <span className="muted small">{t("profile.languageHint")}</span>
                {windowLook && look && (
                  <>
                    <h3>{t("settings.window")}</h3>
                    <label className="stack">{t("settings.windowMaterial")}
                      <select value={look.material} onChange={(e) => changeLook({ ...look, material: e.target.value as WindowAppearance["material"] })}>
                        <option value="none">{t("settings.windowMaterial.none")}</option>
                        {windowLook.materials.map((m) => <option key={m} value={m}>{t(`settings.windowMaterial.${m}`)}</option>)}
                      </select>
                    </label>
                    <label className="stack">{t("settings.windowOpacity", { n: Math.round(look.opacity * 100) })}
                      <input type="range" min={40} max={100} step={5} value={Math.round(look.opacity * 100)} disabled={look.material === "none"} onChange={(e) => changeLook({ ...look, opacity: Number(e.target.value) / 100 })} />
                    </label>
                    <span className="muted small">{t("settings.windowHint")}</span>
                  </>
                )}
                <h3>{t("settings.speakerView")}</h3>
                <label className="check">
                  <input type="checkbox" checked={settings.featureSelfInSpeakerView} onChange={(e) => update({ featureSelfInSpeakerView: e.target.checked })} />
                  {t("settings.featureSelf")}
                </label>
                <span className="muted small">{t("settings.featureSelfHint")}</span>
                <h3>{t("settings.idle")}</h3>
                <label className="check">
                  {/* The permission prompt only opens inside the click, so the switch asks right here. */}
                  <input type="checkbox" checked={idleDetect} disabled={!idleDetectionSupported()} onChange={(e) => { const on = e.target.checked; void setIdleDetection(activity, on).then((ok) => { setIdleDetect(ok); setIdleDenied(on && !ok); }); }} />
                  {t("settings.idleDetect")}
                </label>
                <span className="muted small">{t("settings.idleHint")}</span>
                {!idleDetectionSupported() && <span className="muted small">{t("settings.idleUnsupported")}</span>}
                {idleDenied && <span className="error small">{t("settings.idleDenied")}</span>}
              </>
            )}

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

            {tab === "audio" && (
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
                <label className="stack">
                  {t("settings.radioAudio")}
                  {/* Only stored: App.tsx hands the choice to the radio player, which switches a running stream over at once. */}
                  <select value={settings.radioOutputDeviceId ?? ""} disabled={devices.outputs.length === 0}
                    onChange={(e) => update({ radioOutputDeviceId: e.target.value || null })}>
                    <option value="">{t("settings.sameAsVoice")}</option>
                    {devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                  </select>
                  <span className="muted small">{t("settings.radioAudioHint")}</span>
                </label>
                {!joined && <span className="muted small">{t("settings.deviceNamesHint")}</span>}
                <span className="muted small">{t("settings.devicesLocal")}</span>
              </>
            )}

            {tab === "sounds" && (
              <>
                <h3>{t("settings.soundsHead")}</h3>
                {SOUND_CUES.map((cue) => (
                  <div className="row" key={cue}>
                    <label className="check">
                      <input type="checkbox" checked={settings.sounds[cue]}
                        onChange={(e) => update({ sounds: { ...settingsRef.current.sounds, [cue]: e.target.checked } as SoundSettings })} />
                      {SOUND_LABELS[cue]}
                    </label>
                    <button className="icon" title={t("settings.soundPreview")} aria-label={`${SOUND_LABELS[cue]}: ${t("settings.soundPreview")}`}
                      onClick={() => client.playSound(cue, true)}><Icon name="play" /></button>
                  </div>
                ))}
                <label className="stack">
                  {t("settings.soundVolume", { pct: Math.round(settings.sounds.volume * 100) })}
                  <input type="range" min={0} max={1} step={0.05} value={settings.sounds.volume}
                    onChange={(e) => update({ sounds: { ...settingsRef.current.sounds, volume: Number(e.target.value) } })} />
                </label>
                <span className="muted small">{t("settings.soundsHint")}</span>
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
                  <span className="muted small">{t("settings.cameraPreselect")} {t("settings.devicesLocal")}</span>
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

            {tab === "sessions" && (
              <>
                <h3>{t("profile.devices")}</h3>
                <span className="muted small">{t("profile.devicesHint")}</span>
                {sessions === null ? <span className="muted">{t("common.loading")}</span> : (
                  <ul className="session-list">
                    {sessions.map((s) => (
                      <li key={s.id}>
                        <div className="stack">
                          <span><strong>{s.label ?? t("profile.unknownDevice")}</strong> {s.current && <span className="badge">{t("profile.thisDevice")}</span>}</span>
                          <span className="muted small">{t("profile.signedIn", { date: fmt(s.createdAt) })}{s.lastUsedAt ? ` · ${t("profile.lastActive", { date: fmt(s.lastUsedAt) })}` : ""}</span>
                        </div>
                        <span className="spacer" />
                        {!s.current && <button className="secondary small" disabled={busy} onClick={() => void revoke(s)}>{t("profile.signOut")}</button>}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="row">
                  <button className="secondary" disabled={busy || others === 0} onClick={() => void revokeOthers()}>{t("profile.signOutOthers")}{others ? ` (${others})` : ""}</button>
                  <button className="secondary" disabled={busy} onClick={() => void loadSessions()}>{t("common.refresh")}</button>
                </div>
              </>
            )}

            {tab === "account" && (
              <>
                <h3>{t("profile.identity")}</h3>
                {handle ? <p>{t("login.handle")}: <strong>@{handle}</strong>{dirHost ? <span className="muted small"> {t("login.verifiedAt", { host: dirHost })}</span> : null}</p> : <p className="muted small">{t("profile.noHandle")}</p>}
                <span className="muted small">{t("profile.publicKey")}</span>
                <code className="key">{me?.publicKey ?? publicKey ?? "…"}</code>
                {directoryUrl && (
                  <p className="muted small">
                    <a href={`${directoryUrl}/?handle=${encodeURIComponent(handle ?? "")}`} target="_blank" rel="noreferrer">{t("profile.manageAt", { host: dirHost ?? "" })}</a>{t("profile.manageHint")}
                  </p>
                )}
                <div className="row">
                  <button className="secondary" onClick={onLogout}>{t("profile.signOut")}</button>
                  <button className="danger" onClick={() => void forget()}>{t("profile.forgetIdentity")}</button>
                </div>
              </>
            )}

            {tab === "licenses" && <LicensesTab version={clientVersion} />}

            {SYNCED.includes(tab) && (
              <>
                <span className="muted small settings-sync"><Icon name={inAccount ? "cloud" : "monitor"} /> {inAccount ? t("settings.syncAccount", { handle: directoryAccount?.handle ?? "" }) : t("settings.syncDevice")}</span>
                {syncError && <p className="error small">{t("settings.syncError", { error: syncError })}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
