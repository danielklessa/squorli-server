import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPanel } from "./AdminPanel";
import { ChatView } from "./ChatView";
import { DebugPanel } from "./DebugPanel";
import { LoginScreen } from "./LoginScreen";
import { MemberList } from "./MemberList";
import { Sidebar } from "./Sidebar";
import { VoiceDock, loadVoiceSettings } from "./VoiceDock";
import { VoiceStage } from "./VoiceStage";
import { CameraPicker } from "./CameraPicker";
import { Icon } from "./Icon";
import { ProfileDialog } from "./ProfileDialog";
import { applyBranding } from "./branding";
import { saveVoiceSettings } from "./voice/settings";
import { Permission, hasPermission } from "@squorli/protocol";
import { rtcToken } from "./api";
import { Store, type State } from "./store";
import { VoiceClient, type VoiceState } from "./voice/voiceClient";
import type { VoiceSettings } from "./voice/settings";

export function App() {
  const store = useMemo(() => new Store(), []);
  const client = useMemo(() => new VoiceClient(), []);
  const [state, setState] = useState<State>(store.state);
  const [voice, setVoice] = useState<VoiceState>(client.state);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showDebug, setShowDebug] = useState(() => new URLSearchParams(window.location.search).has("debug"));
  /** Buehne (Kacheln/Bildschirm) statt Chat im Hauptbereich; Sprache laeuft unabhaengig davon weiter. */
  const [stageOpen, setStageOpen] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  /** Kamera-Auswahl offen (Liste der Kameras), wenn beim Einschalten mehr als eine vorhanden ist. */
  const [cameraPick, setCameraPick] = useState<MediaDeviceInfo[] | null>(null);

  // Kamera an/aus. Bei mehreren Kameras immer erst fragen (Vorgabe des Nutzers), bei einer direkt einschalten.
  const toggleCamera = useCallback(async () => {
    if (voice.cameraOn) { await client.setCameraEnabled(false); return; }
    const { cameras } = await VoiceClient.listDevices(true).catch(() => ({ cameras: [] as MediaDeviceInfo[] }));
    // Dialog, sobald es etwas zu waehlen gibt: mehrere Kameras oder ein waehlbarer Hintergrund.
    if (cameras.length > 1 || (cameras.length === 1 && VoiceClient.supportsBlur())) setCameraPick(cameras);
    else await client.setCameraEnabled(true, cameras[0]?.deviceId ?? null, voiceSettings.cameraQuality, voiceSettings.cameraBlur);
  }, [client, voice.cameraOn, voiceSettings.cameraQuality, voiceSettings.cameraBlur]);

  // Hintergrund-Unschaerfe an/aus (Staerke aus den Einstellungen, Standard leicht).
  const toggleBlur = useCallback(async () => {
    const next = voice.cameraBlur > 0 ? 0 : (voiceSettings.cameraBlur || 10);
    const s = { ...voiceSettings, cameraBlur: next };
    setVoiceSettings(s); saveVoiceSettings(s);
    await client.setCameraBlur(next);
  }, [client, voice.cameraBlur, voiceSettings]);

  const pickCamera = useCallback(async (deviceId: string, blur: number) => {
    setCameraPick(null);
    const next = { ...voiceSettings, cameraDeviceId: deviceId, cameraBlur: blur };
    setVoiceSettings(next); saveVoiceSettings(next);
    await client.setCameraEnabled(true, deviceId, next.cameraQuality, next.cameraBlur);
  }, [client, voiceSettings]);

  useEffect(() => store.subscribe(setState), [store]);
  useEffect(() => client.subscribe(setVoice), [client]);
  useEffect(() => { store.onRemoved = () => { void client.leave(); }; void store.init(); }, [store, client]);

  // Unerwartete Trennung von LiveKit: auch die Kanal-Praesenz am App-Server zuruecknehmen.
  const [wasInVoice, setWasInVoice] = useState(false);
  useEffect(() => {
    const now = voice.status !== "disconnected";
    if (wasInVoice && !now) { store.send({ type: "voice.leave" }); setStageOpen(false); }
    setWasInVoice(now);
  }, [voice.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tipp-Anzeigen altern lassen (Re-Render alle 2 s)
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((t) => t + 1), 2000); return () => clearInterval(id); }, []);

  const joinVoice = useCallback(async (channelId: string) => {
    client.prepareAudio(); // noch in der Nutzergeste, vor dem ersten await (Autoplay-/AudioContext-Regeln der Browser)
    setStageOpen(true);
    if (voice.channelId === channelId) return;
    const { url, token } = await rtcToken(channelId);
    const ice = new URLSearchParams(window.location.search).get("ice");
    const ch = store.state.server?.channels.find((c) => c.id === channelId);
    await client.join(channelId, url, token, loadVoiceSettings(), {
      ...(ice === "relay" ? { iceTransportPolicy: "relay" as const } : {}),
      audio: { bitrate: ch?.audioBitrate ?? 64, stereo: ch?.audioStereo ?? false },
    });
    store.send({ type: "voice.join", channelId });
  }, [client, store, voice.channelId]);

  // Sprachprofil des Kanals geaendert (Verwaltung) -> Mikrofon live umstellen.
  const profileChannel = state.server?.channels.find((c) => c.id === voice.channelId);
  useEffect(() => {
    if (profileChannel) void client.setAudioProfile({ bitrate: profileChannel.audioBitrate, stereo: profileChannel.audioStereo });
  }, [client, profileChannel?.audioBitrate, profileChannel?.audioStereo]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaveVoice = useCallback(async () => {
    store.send({ type: "voice.leave" });
    await client.leave();
  }, [client, store]);

  // Moderation (M3): Verschieben und Beenden durch einen Moderator ausfuehren und dem Nutzer sagen, was passiert ist.
  useEffect(() => {
    store.onVoiceMoved = (channelId, by) => {
      if (channelId) {
        const name = store.state.server?.channels.find((c) => c.id === channelId)?.name ?? "einen anderen Kanal";
        client.setNotice(`${by} hat dich nach "${name}" verschoben.`);
        void joinVoice(channelId).catch(() => {});
      } else {
        client.setNotice(`${by} hat dich aus dem Sprachkanal entfernt.`);
        void leaveVoice();
      }
    };
    store.onVoiceStop = (what, by) => {
      const parts = [what.camera && voice.cameraOn ? "Kamera" : "", what.screen && voice.screenOn ? "Bildschirmfreigabe" : ""].filter(Boolean);
      if (what.camera) void client.setCameraEnabled(false);
      if (what.screen) void client.setScreenShareEnabled(false);
      if (parts.length) client.setNotice(`${by} hat deine ${parts.join(" und ")} beendet.`);
    };
    return () => { store.onVoiceMoved = null; store.onVoiceStop = null; };
  }, [store, client, joinVoice, leaveVoice, voice.cameraOn, voice.screenOn]);

  // Seitentitel = Servername, Favicon = Server-Icon (Verwaltung) oder Squorli-Signet; gilt auch fuer den Login-Bildschirm.
  const title = state.server?.settings.name ?? state.serverName ?? "Squorli";
  const iconUrl = state.server ? state.server.settings.iconUrl : state.iconUrl;
  useEffect(() => applyBranding(title, iconUrl), [title, iconUrl]);

  const server = state.server;
  if (!server || !state.me || !state.userId) return <LoginScreen store={store} state={state} />;

  const current = server.channels.find((c) => c.id === state.currentChannelId && c.kind === "text") ?? null;
  const voiceChannel = server.channels.find((c) => c.id === voice.channelId) ?? null;
  const me = server.members.find((m) => m.userId === state.userId);
  const canStream = hasPermission(server.myPermissions, Permission.STREAM_VIDEO);
  const showStage = stageOpen && voiceChannel !== null;

  return (
    <div className="app">
      <div className="left">
        <Sidebar
          server={server} currentChannelId={state.currentChannelId} voice={state.voice} voiceState={voice} unread={state.unread}
          connection={state.connection} onSelect={(id) => { store.selectChannel(id); setStageOpen(false); }}
          onJoinVoice={(id) => { void joinVoice(id).catch(() => {}); }} onOpenAdmin={() => setShowAdmin(true)} myUserId={state.userId}
        />
        <VoiceDock client={client} voice={voice} channel={voiceChannel} displayName={me?.displayName ?? "…"} onLeave={leaveVoice} onOpenProfile={() => setShowProfile(true)}
          onOpenStage={voiceChannel && !showStage ? () => setStageOpen(true) : null} canStream={canStream} onSettings={setVoiceSettings} onToggleCamera={toggleCamera} />
      </div>

      <main className="main">
        {showStage && voiceChannel ? (
          <VoiceStage client={client} voice={voice} channel={voiceChannel} members={server.members} myPermissions={server.myPermissions}
            onToggleCamera={toggleCamera} onToggleBlur={toggleBlur} onLeave={leaveVoice} onClose={() => setStageOpen(false)} />
        ) : current ? (
          <ChatView
            channel={current} messages={state.messages[current.id] ?? { list: [], hasMore: true, loaded: false, loading: false }}
            members={server.members} myUserId={state.userId} myPermissions={server.myPermissions}
            typing={state.typing[current.id] ?? {}} store={store}
          />
        ) : (
          <section className="chat empty"><p className="muted">Kein Textkanal vorhanden.</p></section>
        )}
        {showDebug && <DebugPanel log={state.log} client={client} voice={voice} />}
        <button className="debug-toggle icon" title="Debug" onClick={() => setShowDebug((v) => !v)}><Icon name="bug" /></button>
      </main>

      <MemberList members={server.members} roles={server.roles} myUserId={state.userId} myPermissions={server.myPermissions} ownerId={server.settings.ownerId}
        voice={state.voice} channels={server.channels} />

      {showAdmin && <AdminPanel server={server} onClose={() => setShowAdmin(false)} />}
      {cameraPick && <CameraPicker cameras={cameraPick} initial={voiceSettings.cameraDeviceId} initialBlur={voiceSettings.cameraBlur} onPick={(id, b) => { void pickCamera(id, b); }} onCancel={() => setCameraPick(null)} />}
      {showProfile && (
        <ProfileDialog me={state.me} directoryUrl={state.directoryUrl} directoryAccount={state.directoryAccount} serverDomain={state.serverDomain}
          onSaveDirectoryName={(server, n) => store.setDirectoryName(server, n)} onClose={() => setShowProfile(false)}
          onLogout={() => { setShowProfile(false); void client.leave(); store.logout(); }}
          onForget={() => { setShowProfile(false); void client.leave(); void store.forgetIdentity(); }} />
      )}
    </div>
  );
}
