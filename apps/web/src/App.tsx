import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./AdminPanel";
import { ChatView } from "./ChatView";
import { DebugPanel } from "./DebugPanel";
import { HomeMain, HomeSidebar } from "./Home";
import { LoginScreen } from "./LoginScreen";
import { MemberList } from "./MemberList";
import { Sidebar } from "./Sidebar";
import { VoiceDock, loadVoiceSettings } from "./VoiceDock";
import { VoiceStage } from "./VoiceStage";
import { CameraPicker } from "./CameraPicker";
import { Icon } from "./Icon";
import { ProfileDialog } from "./ProfileDialog";
import { applyBranding } from "./branding";
import { ServerBrowser } from "./ServerBrowser";
import { ServerRail, type RailServer } from "./ServerRail";
import { saveVoiceSettings } from "./voice/settings";
import { Permission, directoryServerIconUrl, directoryServerUrl, hasPermission } from "@squorli/protocol";
import { Store, activeState, homeState, type State } from "./store";
import { VoiceClient, type VoiceState } from "./voice/voiceClient";
import type { VoiceSettings } from "./voice/settings";
import { t } from "./i18n";

export function App() {
  const store = useMemo(() => new Store(), []);
  const client = useMemo(() => new VoiceClient(), []);
  const [state, setState] = useState<State>(store.state);
  const [voice, setVoice] = useState<VoiceState>(client.state);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showDebug, setShowDebug] = useState(() => new URLSearchParams(window.location.search).has("debug"));
  /** Stage (tiles/screen) instead of chat in the main area; voice keeps running independently. */
  const [stageOpen, setStageOpen] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  /** Camera picker open (list of cameras) when there is more than one at switch-on time. */
  const [cameraPick, setCameraPick] = useState<MediaDeviceInfo[] | null>(null);
  /**
   * Server the voice connection belongs to (multi-server client): it survives switching the displayed server;
   * only joining a voice channel on another server ends it (as the user specified).
   */
  const [voiceHost, setVoiceHost] = useState<string | null>(null);
  const voiceHostRef = useRef<string | null>(null);
  voiceHostRef.current = voiceHost;

  // Camera on/off. With several cameras always ask first (as the user specified), with one switch on directly.
  const toggleCamera = useCallback(async () => {
    if (voice.cameraOn) { await client.setCameraEnabled(false); return; }
    const { cameras } = await VoiceClient.listDevices(true).catch(() => ({ cameras: [] as MediaDeviceInfo[] }));
    // Dialog as soon as there is something to choose: several cameras or a selectable background.
    if (cameras.length > 1 || (cameras.length === 1 && VoiceClient.supportsBlur())) setCameraPick(cameras);
    else await client.setCameraEnabled(true, cameras[0]?.deviceId ?? null, voiceSettings.cameraQuality, voiceSettings.cameraBlur);
  }, [client, voice.cameraOn, voiceSettings.cameraQuality, voiceSettings.cameraBlur]);

  // Background blur on/off (strength from the settings, default light).
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
  useEffect(() => {
    // A kick, ban or session loss on the voice connection's server ends it.
    store.onRemoved = (host) => { if (host === voiceHostRef.current) { void client.leave(); setVoiceHost(null); } };
    void store.init();
  }, [store, client]);

  // Unexpected disconnect from LiveKit: also withdraw the channel presence at the app server.
  const [wasInVoice, setWasInVoice] = useState(false);
  useEffect(() => {
    const now = voice.status !== "disconnected";
    if (wasInVoice && !now) {
      if (voiceHostRef.current) store.connection(voiceHostRef.current)?.send({ type: "voice.leave" });
      setVoiceHost(null); setStageOpen(false);
    }
    setWasInVoice(now);
  }, [voice.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Let typing indicators age out (re-render every 2 s)
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((t) => t + 1), 2000); return () => clearInterval(id); }, []);

  const leaveVoice = useCallback(async () => {
    if (voiceHostRef.current) store.connection(voiceHostRef.current)?.send({ type: "voice.leave" });
    setVoiceHost(null);
    await client.leave();
  }, [client, store]);

  /** Join a voice channel on `host`; if voice is running on another server, it is ended there first. */
  const joinVoice = useCallback(async (host: string, channelId: string) => {
    client.prepareAudio(); // still inside the user gesture, before the first await (browsers' autoplay/AudioContext rules)
    const conn = store.connection(host);
    if (!conn) return;
    setStageOpen(true);
    if (voiceHostRef.current === host && voice.channelId === channelId) return;
    if (voiceHostRef.current && voiceHostRef.current !== host) await leaveVoice();
    const { url, token } = await conn.api.rtcToken(channelId);
    const ice = new URLSearchParams(window.location.search).get("ice");
    const ch = conn.state.server?.channels.find((c) => c.id === channelId);
    await client.join(channelId, url, token, loadVoiceSettings(), {
      ...(ice === "relay" ? { iceTransportPolicy: "relay" as const } : {}),
      audio: { bitrate: ch?.audioBitrate ?? 64, stereo: ch?.audioStereo ?? false },
    });
    setVoiceHost(host);
    conn.send({ type: "voice.join", channelId });
  }, [client, store, voice.channelId, leaveVoice]);

  const voiceServer = voiceHost ? state.servers[voiceHost] ?? null : null;
  const voiceChannel = voiceServer?.server?.channels.find((c) => c.id === voice.channelId) ?? null;

  // The channel's voice profile changed (admin) -> switch the microphone over live.
  useEffect(() => {
    if (voiceChannel) void client.setAudioProfile({ bitrate: voiceChannel.audioBitrate, stereo: voiceChannel.audioStereo });
  }, [client, voiceChannel?.audioBitrate, voiceChannel?.audioStereo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moderation (M3): carry out a moderator's move or stop and tell the user what happened.
  useEffect(() => {
    store.onVoiceMoved = (host, channelId, by) => {
      if (host !== voiceHostRef.current) return;
      if (channelId) {
        const name = store.connection(host)?.state.server?.channels.find((c) => c.id === channelId)?.name ?? t("app.otherChannel");
        client.setNotice(t("app.movedNotice", { by, name }));
        void joinVoice(host, channelId).catch(() => {});
      } else {
        client.setNotice(t("app.removedNotice", { by }));
        void leaveVoice();
      }
    };
    store.onVoiceStop = (host, what, by) => {
      if (host !== voiceHostRef.current) return;
      const parts = [what.camera && voice.cameraOn ? t("app.camera") : "", what.screen && voice.screenOn ? t("app.screenShare") : ""].filter(Boolean);
      if (what.camera) void client.setCameraEnabled(false);
      if (what.screen) void client.setScreenShareEnabled(false);
      if (parts.length) client.setNotice(t("app.stoppedNotice", { by, what: parts.join(t("app.and")) }));
    };
    return () => { store.onVoiceMoved = null; store.onVoiceStop = null; };
  }, [store, client, joinVoice, leaveVoice, voice.cameraOn, voice.screenOn]);

  const home = homeState(state);
  const active = activeState(state);
  const activeHost = state.activeHost;
  const conn = store.connection(activeHost) ?? store.home;

  // Page title = name of the displayed server, favicon = its icon (admin) or the Squorli mark; also applies to the login screen.
  const title = active.server?.settings.name ?? active.serverName ?? "Squorli";
  const iconUrl = active.server ? (active.server.settings.iconUrl ? conn.api.abs(active.server.settings.iconUrl) : null) : active.iconUrl;
  useEffect(() => applyBranding(title, iconUrl), [title, iconUrl]);

  if (!home.server || !home.me || !home.userId) return <LoginScreen store={store} state={state} />;

  const server = active.server;
  const current = server?.channels.find((c) => c.id === active.currentChannelId && c.kind === "text") ?? null;
  const me = server?.members.find((m) => m.userId === active.userId);
  const canStream = !!server && hasPermission(server.myPermissions, Permission.STREAM_VIDEO);
  // The stage belongs to the voice connection's server; on another server the dock shows "view" and switches there.
  const showStage = stageOpen && voiceChannel !== null && voiceHost === activeHost;
  // M7: home view with friends and direct messages as soon as the directory socket exists (an account at the directory).
  const homeAvailable = state.friends !== null || state.directoryLink !== "idle";
  const homeOpen = homeAvailable && state.homeOpen;
  const homeBadge = (state.friends ?? []).filter((f) => f.state === "pending_in").length + Object.values(state.conversations).reduce((n, c) => n + c.unread, 0);
  const friendsMenu = homeAvailable ? {
    stateOf: (pk: string) => store.friendState(pk) ?? null,
    onRequest: (pk: string) => { store.requestFriend(pk); store.openHome(true); },
    onMessage: (pk: string) => { const st = store.friendState(pk); if (st === "accepted") store.selectPeer(pk); else store.openHome(true); },
  } : null;

  // Server rail: own server first, then the account's servers from the directory (without duplicating our own).
  const railServers: RailServer[] = [];
  const homeDirHost = home.serverDomain ?? window.location.hostname;
  railServers.push({ key: state.homeHost, host: homeDirHost, name: home.server.settings.name, sub: null, iconUrl: home.server.settings.iconUrl });
  for (const s of (state.accountServers ?? []).slice().sort((a, b) => (b.lastSeenAt < a.lastSeenAt ? -1 : b.lastSeenAt > a.lastSeenAt ? 1 : 0))) {
    const key = store.hostFor(s.host);
    if (key === state.homeHost) continue;
    railServers.push({ key, host: s.host, name: s.name ?? s.host, sub: s.displayName ? t("app.asName", { name: s.displayName }) : null, iconUrl: state.directoryUrl ? directoryServerIconUrl(state.directoryUrl, s.host, s.iconUpdatedAt) : null });
  }
  const railState = Object.fromEntries(Object.entries(state.servers).map(([k, s]) => [k, {
    unread: Object.values(s.unread).some(Boolean), voice: k === voiceHost && voice.status !== "disconnected", connection: s.connection,
  }]));

  return (
    <div className={`app ${state.directoryUrl ? "with-rail" : ""} ${homeOpen ? "home" : ""}`}>
      {state.directoryUrl && <ServerRail servers={railServers} serverState={railState} activeKey={homeOpen ? null : activeHost}
        onSelect={(key, host) => { if (key === state.homeHost) { store.openServer(homeDirHost); } else store.openServer(host); setStageOpen(key === voiceHost && stageOpen); }}
        onDiscover={() => setShowBrowser(true)}
        home={homeAvailable ? { open: homeOpen, badge: homeBadge, onToggle: () => store.openHome(!homeOpen) } : null} />}
      {showBrowser && state.directoryUrl && <ServerBrowser directoryUrl={state.directoryUrl} currentHost={home.serverDomain} onClose={() => setShowBrowser(false)} />}
      <div className="left">
        {homeOpen ? <HomeSidebar state={state} store={store} members={server?.members ?? []} /> : server ? <Sidebar
          server={server} api={conn.api} currentChannelId={showStage && voiceChannel ? voiceChannel.id : active.currentChannelId} voice={active.voice}
          voiceState={voiceHost === activeHost ? voice : null} unread={active.unread}
          connection={active.connection} onSelect={(id) => { conn.selectChannel(id); setStageOpen(false); }}
          onJoinVoice={(id) => { void joinVoice(activeHost, id).catch(() => {}); }} onOpenAdmin={() => setShowAdmin(true)} myUserId={active.userId ?? ""}
        /> : <nav className="sidebar"><header className="server-head"><img className="brand-mark" src="/brand/squorli-icon-small.svg" alt="" width="22" height="22" /><strong>{active.serverName ?? active.host}</strong></header></nav>}
        <VoiceDock client={client} voice={voice} channel={voiceChannel} serverName={voiceHost && voiceHost !== activeHost ? voiceServer?.server?.settings.name ?? voiceHost : null}
          displayName={me?.displayName ?? home.me.displayName ?? "…"} onLeave={leaveVoice} onOpenProfile={() => setShowProfile(true)}
          onOpenStage={voiceChannel && !showStage && voiceHost ? () => { store.openServer(voiceHost === state.homeHost ? homeDirHost : voiceHost); setStageOpen(true); } : null}
          canStream={!!voiceServer?.server && hasPermission(voiceServer.server.myPermissions, Permission.STREAM_VIDEO)} onSettings={setVoiceSettings} onToggleCamera={toggleCamera} />
      </div>

      <main className="main">
        {homeOpen ? (
          <HomeMain state={state} store={store} />
        ) : !server ? (
          <ServerStatus s={active} onRetry={() => store.retryServer(activeHost)} onClose={() => store.closeServer(activeHost)} />
        ) : showStage && voiceChannel ? (
          <VoiceStage client={client} voice={voice} channel={voiceChannel} members={server.members} myPermissions={server.myPermissions}
            onToggleCamera={toggleCamera} onToggleBlur={toggleBlur} onLeave={leaveVoice} />
        ) : current ? (
          <ChatView
            channel={current} messages={active.messages[current.id] ?? { list: [], hasMore: true, loaded: false, loading: false }}
            members={server.members} myUserId={active.userId!} myPermissions={server.myPermissions}
            typing={active.typing[current.id] ?? {}} conn={conn}
          />
        ) : (
          <section className="chat empty"><p className="muted">{t("app.noTextChannel")}</p></section>
        )}
        {showDebug && <DebugPanel log={active.log} client={client} voice={voice} />}
        <button className="debug-toggle icon" title={t("app.debug")} onClick={() => setShowDebug((v) => !v)}><Icon name="bug" /></button>
      </main>

      {!homeOpen && server && <MemberList api={conn.api} members={server.members} roles={server.roles} myUserId={active.userId!} myPermissions={server.myPermissions} ownerId={server.settings.ownerId}
        voice={active.voice} channels={server.channels} friends={friendsMenu} />}

      {showAdmin && server && <AdminPanel api={conn.api} server={server} directoryUrl={active.directoryUrl} onClose={() => setShowAdmin(false)} />}
      {cameraPick && <CameraPicker cameras={cameraPick} initial={voiceSettings.cameraDeviceId} initialBlur={voiceSettings.cameraBlur} onPick={(id, b) => { void pickCamera(id, b); }} onCancel={() => setCameraPick(null)} />}
      {showProfile && active.me && (
        <ProfileDialog api={conn.api} me={active.me} directoryUrl={state.directoryUrl} directoryAccount={state.directoryAccount} serverDomain={active.serverDomain}
          onSaveDirectoryName={(s, n) => store.setDirectoryName(s, n)} onClose={() => setShowProfile(false)}
          onLogout={() => { setShowProfile(false); void client.leave(); store.logout(); }}
          onForget={() => { setShowProfile(false); void client.leave(); void store.forgetIdentity(); }} />
      )}
    </div>
  );
}

/** Main area for a foreign server that has no state (yet): connecting, error, removed. */
function ServerStatus({ s, onRetry, onClose }: { s: State["servers"][string]; onRetry: () => void; onClose: () => void }) {
  const busy = s.connection === "logging-in" || s.connection === "connecting" || s.connection === "reconnecting";
  const name = s.serverName ?? s.host;
  return (
    <section className="chat empty server-status">
      <div className="stack">
        <h2>{name}</h2>
        {busy && <p className="muted">{t("status.connecting", { host: s.host })}</p>}
        {s.removed && <p className="error">{s.removed.reason === "banned" ? t("status.banned") : t("status.removed")}{s.removed.message ? `: ${s.removed.message}` : "."}</p>}
        {s.error && <p className="error">{s.error}</p>}
        {!busy && (
          <div className="row">
            <button onClick={onRetry}>{t("common.retry")}</button>
            <a className="link-btn" href={directoryServerUrl(s.host)}>{t("status.openDirect")}</a>
            <button className="secondary" onClick={onClose}>{t("common.close")}</button>
          </div>
        )}
      </div>
    </section>
  );
}
