import { useVideoWindows } from "./VideoWindows";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./AdminPanel";
import { ChatView } from "./ChatView";
import { DebugPanel } from "./DebugPanel";
import { HomeMain, HomeSidebar } from "./Home";
import { LoginScreen } from "./LoginScreen";
import { MemberList } from "./MemberList";
import { Sidebar } from "./Sidebar";
import { VoiceDock } from "./VoiceDock";
import { VoiceStage } from "./VoiceStage";
import { CameraPicker } from "./CameraPicker";
import { Icon } from "./Icon";
import { askConfirm } from "./dialogs";
import type { MenuAnchor } from "./ContextMenu";
import { MiniProfile } from "./MiniProfile";
import { SettingsDialog, type SettingsTab } from "./SettingsDialog";
import { applyBranding } from "./branding";
import { ServerBrowser } from "./ServerBrowser";
import { ServerRail, type RailServer } from "./ServerRail";
import { loadVoiceSettings, saveVoiceSettings } from "./voice/settings";
import { useVoiceSettings } from "./voice/useVoiceSettings";
import { Permission, directoryServerIconUrl, directoryServerUrl, displayNameOf, hasPermission, type Member } from "@squorli/protocol";
import { Store, activeState, homeState, type State } from "./store";
import { VoiceClient, type VoiceState } from "./voice/voiceClient";
import { RadioPlayer, type RadioState } from "./voice/radioPlayer";
import { EmbedPlayer, embedKeyOf, usePlayerWindow, type EmbedSource } from "./EmbedPlayer";
import { videoAccessOf } from "./voice/videoAccess";
import { activity, watchActivity } from "./activity";
import { resumeIdleDetection } from "./idleDetection";
import { t } from "./i18n";

const peerKeysOf = (members: Member[]): Record<string, string> => Object.fromEntries(members.map((m) => [m.userId, m.publicKey]));

export function App() {
  const store = useMemo(() => new Store(), []);
  const client = useMemo(() => new VoiceClient(), []);
  const radio = useMemo(() => new RadioPlayer(), []);
  const [state, setState] = useState<State>(store.state);
  const [voice, setVoice] = useState<VoiceState>(client.state);
  const [showAdmin, setShowAdmin] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  /** Mini profile (click on your own name), anchored at the name in the dock. */
  const [miniProfile, setMiniProfile] = useState<MenuAnchor | null>(null);
  /** Settings dialog (gear): the category to open, null = closed. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  /** The settings dialog is capturing a new push-to-talk key; the dock's listener stays quiet meanwhile. */
  const [capturingPttKey, setCapturingPttKey] = useState(false);
  const [showDebug, setShowDebug] = useState(() => new URLSearchParams(window.location.search).has("debug"));
  /** Stage (tiles/screen) instead of chat in the main area; voice keeps running independently. */
  const [stageOpen, setStageOpen] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const voiceSettings = useVoiceSettings();
  /** Camera picker open (list of cameras) when there is more than one at switch-on time. */
  const [cameraPick, setCameraPick] = useState<MediaDeviceInfo[] | null>(null);
  /**
   * Server the voice connection belongs to (multi-server client): it survives switching the displayed server;
   * only joining a voice channel on another server ends it (as the user specified).
   */
  const [voiceHost, setVoiceHost] = useState<string | null>(null);
  const voiceHostRef = useRef<string | null>(null);
  voiceHostRef.current = voiceHost;
  /** Moved to the AFK channel for inactivity: the voice channel the dock offers the way back to (user's decision: never automatically). */
  const [afkReturn, setAfkReturn] = useState<{ host: string; channelId: string } | null>(null);

  // AFK detection: input in this window, speaking (open gate of an unmuted microphone) and, where the user allowed it,
  // input anywhere in the system keep the user present (activity.ts); the store reports the state to servers and directory.
  useEffect(() => { void resumeIdleDetection(activity); return watchActivity(activity); }, []);
  useEffect(() => client.subscribe((s) => { if (s.gateOpen && !s.micMuted) activity.touch(); }), [client]);

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
    saveVoiceSettings(s);
    await client.setCameraBlur(next);
  }, [client, voice.cameraBlur, voiceSettings]);

  const pickCamera = useCallback(async (deviceId: string, blur: number) => {
    setCameraPick(null);
    const next = { ...voiceSettings, cameraDeviceId: deviceId, cameraBlur: blur };
    saveVoiceSettings(next);
    await client.setCameraEnabled(true, deviceId, next.cameraQuality, next.cameraBlur);
  }, [client, voiceSettings]);

  useEffect(() => store.subscribe(setState), [store]);
  useEffect(() => client.subscribe(setVoice), [client]);
  // Cue settings reach the voice client from here, whether the user changed them or the directory account supplied them.
  useEffect(() => client.setSoundSettings(voiceSettings.sounds), [client, voiceSettings.sounds]);
  // The same for the speech gate: the settings dialog only stores, a running connection follows from here.
  useEffect(() => client.setMode(voiceSettings.mode), [client, voiceSettings.mode]);
  useEffect(() => client.setThreshold(voiceSettings.vadThreshold), [client, voiceSettings.vadThreshold]);
  useEffect(() => client.setHangover(voiceSettings.vadHangoverMs), [client, voiceSettings.vadHangoverMs]);
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
      setVoiceHost(null); setStageOpen(false); setAfkReturn(null);
    }
    setWasInVoice(now);
  }, [voice.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Let typing indicators age out (re-render every 2 s)
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((t) => t + 1), 2000); return () => clearInterval(id); }, []);

  const leaveVoice = useCallback(async () => {
    if (voiceHostRef.current) store.connection(voiceHostRef.current)?.send({ type: "voice.leave" });
    setVoiceHost(null); setAfkReturn(null);
    await client.leave();
  }, [client, store]);

  /**
   * Join a voice channel on `host`; if voice is running on another server, it is ended there first. `auto` = not the user's
   * own step (moved to the AFK channel, the channel's AFK role changed): the view stays as it is and the way back is kept.
   * `force` joins again although already there (a fresh token with the grants that fit the channel now).
   */
  const joinVoice = useCallback(async (host: string, channelId: string, opts: { auto?: boolean; force?: boolean } = {}) => {
    client.prepareAudio(); // still inside the user gesture, before the first await (browsers' autoplay/AudioContext rules)
    const conn = store.connection(host);
    if (!conn) return;
    if (!opts.auto) { setStageOpen(true); setAfkReturn(null); }
    if (voiceHostRef.current === host && voice.channelId === channelId && !opts.force) return;
    if (voiceHostRef.current && voiceHostRef.current !== host) await leaveVoice();
    const { url, token } = await conn.api.rtcToken(channelId);
    const ice = new URLSearchParams(window.location.search).get("ice");
    const srv = conn.state.server;
    const ch = srv?.channels.find((c) => c.id === channelId);
    await client.join(channelId, url, token, loadVoiceSettings(), {
      ...(ice === "relay" ? { iceTransportPolicy: "relay" as const } : {}),
      audio: { bitrate: ch?.audioBitrate ?? 64, stereo: ch?.audioStereo ?? false },
      ...(srv ? { video: { access: videoAccessOf(srv), mayView: hasPermission(srv.myPermissions, Permission.VIEW_VIDEO) }, peerKeys: peerKeysOf(srv.members) } : {}),
      afk: !!srv && srv.settings.afkChannelId === channelId,
    });
    setVoiceHost(host);
    conn.send({ type: "voice.join", channelId });
  }, [client, store, voice.channelId, leaveVoice]);

  const voiceServer = voiceHost ? state.servers[voiceHost] ?? null : null;
  const videoWindows = useVideoWindows(voice.tiles.map((tile) => {
    const member = voiceServer?.server?.members.find((member) => member.userId === tile.identity);
    return member ? { ...tile, name: displayNameOf(member) } : tile;
  }), client);
  const voiceChannel = voiceServer?.server?.channels.find((c) => c.id === voice.channelId) ?? null;

  // The channel's voice profile changed (admin) -> switch the microphone over live.
  useEffect(() => {
    if (voiceChannel) void client.setAudioProfile({ bitrate: voiceChannel.audioBitrate, stereo: voiceChannel.audioStereo });
  }, [client, voiceChannel?.audioBitrate, voiceChannel?.audioStereo]); // eslint-disable-line react-hooks/exhaustive-deps

  // The admin made this channel the AFK channel (or an ordinary one again): join once more, because the token decides what
  // may be sent and heard there. LiveKit has already enforced it for this connection (server, routes/settings.ts).
  const voiceChannelIsAfk = !!voiceChannel && voiceServer?.server?.settings.afkChannelId === voiceChannel.id;
  useEffect(() => {
    if (voice.status === "connected" && voiceHost && voiceChannel && voiceChannelIsAfk !== voice.afkRoom) void joinVoice(voiceHost, voiceChannel.id, { auto: true, force: true }).catch(() => {});
  }, [voiceChannelIsAfk, voice.afkRoom, voice.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Web radio of the voice channel: played locally, only while connected there; follows deafen.
  const channelRadio = voice.status === "connected" || voice.status === "reconnecting" ? voiceChannel?.radio ?? null : null;
  // A Twitch or YouTube source is no audio stream: the official player shows it (below), the radio player stays off.
  const radioUrl = channelRadio && !channelRadio.twitchChannel && !channelRadio.youtubeVideo ? channelRadio.streamUrl : null;
  const [radioState, setRadioState] = useState<RadioState>(radio.state);
  useEffect(() => radio.subscribe(setRadioState), [radio]);
  // Turned off for me = no player at all: no tile, no sound, no connection to Twitch or YouTube (user's requirement).
  const embedTwitch = !radioState.muted ? channelRadio?.twitchChannel ?? null : null;
  const embedYoutube = !radioState.muted ? channelRadio?.youtubeVideo ?? null : null;
  const embedSource = useMemo<EmbedSource | null>(() => embedTwitch ? { kind: "twitch", channel: embedTwitch } : embedYoutube ? { kind: "youtube", videoId: embedYoutube } : null, [embedTwitch, embedYoutube]);
  const playerWindow = usePlayerWindow(embedKeyOf(embedSource));
  // A video plays in step for everyone; members with CONTROL_RADIO steer it through their own player (EmbedPlayer.tsx).
  const embedSync = useMemo(() => {
    const playback = channelRadio?.playback, channelId = voiceChannel?.id, api = voiceHost ? store.connection(voiceHost)?.api : null;
    if (!embedYoutube || !playback || !channelId || !api) return null;
    return { playback, clockOffset: voiceServer?.clockOffset ?? 0, canControl: hasPermission(voiceServer?.server?.myPermissions ?? 0, Permission.CONTROL_RADIO), publish: (p: { playing: boolean; position: number; rate: number }) => api.setRadioPlayback(channelId, p) };
  }, [embedYoutube, channelRadio?.playback, voiceChannel?.id, voiceHost, store, voiceServer?.clockOffset, voiceServer?.server?.myPermissions]);
  useEffect(() => radio.setStream(radioUrl), [radio, radioUrl]);
  useEffect(() => radio.setDeafened(voice.deafened), [radio, voice.deafened]);
  // Its own output device when one is chosen (settings > audio devices), otherwise where the voices play.
  const radioSink = voiceSettings.radioOutputDeviceId ?? voiceSettings.outputDeviceId;
  useEffect(() => radio.setOutputDevice(radioSink), [radio, radioSink]);

  // Permission VIEW_VIDEO: roles or members changed -> the running connection restricts its camera/screen to the members
  // who may watch (enforced by LiveKit), and stops receiving others' feeds when we lost the permission ourselves.
  const voiceState = voiceServer?.server ?? null;
  const afkReturnChannel = afkReturn && voice.afkRoom ? state.servers[afkReturn.host]?.server?.channels.find((c) => c.id === afkReturn.channelId) ?? null : null;
  useEffect(() => {
    if (voiceState) client.setVideoAccess(videoAccessOf(voiceState), hasPermission(voiceState.myPermissions, Permission.VIEW_VIDEO));
  }, [client, voiceState?.roles, voiceState?.members, voiceState?.settings.ownerId, voiceState?.myPermissions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-person playback volume is stored by public key; the voice client only sees LiveKit identities (user ids of this server).
  useEffect(() => { if (voiceState) client.setPeerKeys(peerKeysOf(voiceState.members)); }, [client, voiceState?.members]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moderation (M3): carry out a moderator's move or stop and tell the user what happened.
  useEffect(() => {
    store.onVoiceMoved = (host, channelId, by, reason) => {
      if (host !== voiceHostRef.current) return;
      if (channelId && reason === "afk") {
        // Inactivity: into the AFK channel; the dock explains it and offers the way back to where the user was.
        const from = client.state.channelId;
        if (from === channelId) return;
        if (from) setAfkReturn({ host, channelId: from });
        void joinVoice(host, channelId, { auto: true }).catch(() => {});
      } else if (channelId) {
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
  // M7: home view with friends and direct messages as soon as the directory socket exists (an account at the directory).
  const homeAvailable = state.friends !== null || state.directoryLink !== "idle";
  const homeOpen = homeAvailable && state.homeOpen;
  // The stage belongs to the voice connection's server; on another server or in the home view the dock shows "view" and switches there.
  const showStage = stageOpen && voiceChannel !== null && voiceHost === activeHost && !homeOpen;
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
    // Muted channels and a muted server give no unread mark; mentions always count.
    unread: !s.serverMuted && Object.entries(s.unread).some(([id, u]) => u && !s.muted[id]), muted: s.serverMuted, canMute: s.readSync && s.connection === "connected", mentions: Object.values(s.mentions).reduce((n, c) => n + c, 0), voice: k === voiceHost && voice.status !== "disconnected", connection: s.connection,
  }]));
  // Rail context menu: delete your account on that server, requested through the directory (own confirmation dialog, no browser dialogs).
  const leaveServer = async (host: string, name: string) => {
    const ok = await askConfirm({ title: t("rail.leaveTitle", { name }), text: t("rail.leaveText"), confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      const r = await store.leaveServer(host);
      if (!r.delivered) await askConfirm({ title: t("rail.leaveTitle", { name }), text: r.registered ? t("rail.leaveQueued") : t("rail.leaveUnregistered"), confirmLabel: t("common.ok") });
    } catch (err) {
      await askConfirm({ title: t("rail.leaveFailed"), text: err instanceof Error ? err.message : String(err), confirmLabel: t("common.ok") });
    }
  };

  return (
    <div className={`app ${state.directoryUrl ? "with-rail" : ""} ${homeOpen ? "home" : ""} ${navigationOpen ? "navigation-open" : ""}`}>
      {videoWindows.windows}
      {embedSource && channelRadio && <EmbedPlayer source={embedSource} name={channelRadio.name} volume={radioState.volume} muted={voice.deafened} popout={playerWindow} sync={embedSync} onNotice={(text) => client.setNotice(text)} />}
      <button className="mobile-navigation secondary" aria-expanded={navigationOpen} aria-controls="app-navigation" onClick={() => setNavigationOpen((open) => !open)}><Icon name={navigationOpen ? "x" : "hash"} />{t("app.navigation")}</button>
      {state.directoryUrl && <ServerRail servers={railServers} serverState={railState} activeKey={homeOpen ? null : activeHost}
        onSelect={(key, host) => { if (key === state.homeHost) { store.openServer(homeDirHost); } else store.openServer(host); setStageOpen(key === voiceHost && stageOpen); }}
        onDiscover={() => setShowBrowser(true)} onLeave={(host, name) => { void leaveServer(host, name); }}
        onMute={(key, muted) => { void store.connection(key)?.setServerMuted(muted).catch(() => {}); }}
        home={homeAvailable ? { open: homeOpen, badge: homeBadge, onToggle: () => store.openHome(!homeOpen) } : null} />}
      {showBrowser && state.directoryUrl && <ServerBrowser directoryUrl={state.directoryUrl} currentHost={home.serverDomain} onClose={() => setShowBrowser(false)} />}
      <div className="left" id="app-navigation">
        {homeOpen ? <HomeSidebar state={state} store={store} members={server?.members ?? []} /> : server ? <Sidebar
          server={server} api={conn.api} currentChannelId={showStage && voiceChannel ? voiceChannel.id : active.currentChannelId} voice={active.voice}
          voiceState={voiceHost === activeHost ? voice : null} client={client} radioTitles={active.radioTitles} unread={active.unread} mentions={active.mentions} muted={active.muted} canMute={active.readSync}
          onMuteChannel={(id, muted) => { void conn.setChannelMuted(id, muted).catch(() => {}); }}
          connection={active.connection} onSelect={(id) => { conn.selectChannel(id); setStageOpen(false); setNavigationOpen(false); }}
          onJoinVoice={(id) => { void joinVoice(activeHost, id).catch(() => {}); }} onOpenAdmin={() => setShowAdmin(true)} myUserId={active.userId ?? ""}
        /> : <nav className="sidebar"><header className="server-head"><img className="brand-mark" src="/brand/squorli-icon-small.svg" alt="" width="22" height="22" /><strong>{active.serverName ?? active.host}</strong></header></nav>}
        <VoiceDock client={client} voice={voice} channel={voiceChannel} serverName={voiceHost && voiceHost !== activeHost ? voiceServer?.server?.settings.name ?? voiceHost : null}
          displayName={me?.displayName ?? home.me.displayName ?? "…"} onLeave={leaveVoice} onOpenProfile={setMiniProfile} onOpenSettings={() => setSettingsTab("profile")} pttSuspended={capturingPttKey}
          onOpenStage={voiceChannel && !showStage && voiceHost ? () => { store.openServer(voiceHost === state.homeHost ? homeDirHost : voiceHost); setStageOpen(true); } : null}
          canStream={!!voiceServer?.server && hasPermission(voiceServer.server.myPermissions, Permission.STREAM_VIDEO)} onToggleCamera={toggleCamera}
          afkReturn={afkReturn && voice.afkRoom ? { name: afkReturnChannel?.name ?? null, onReturn: () => { void joinVoice(afkReturn.host, afkReturn.channelId).catch(() => {}); } } : null} />
      </div>

      <main className="main">
        {homeOpen ? (
          <HomeMain state={state} store={store} />
        ) : !server ? (
          <ServerStatus s={active} onRetry={() => store.retryServer(activeHost)} onClose={() => store.closeServer(activeHost)} />
        ) : showStage && voiceChannel ? (
          <VoiceStage client={client} voice={voice} channel={voiceChannel} members={server.members} myPermissions={server.myPermissions}
            api={conn.api} radio={radio} radioStations={server.radioStations} radioTitle={active.radioTitles[voiceChannel.id] ?? null} playerTile={embedKeyOf(embedSource)} playerPopped={playerWindow.win !== null} onRestorePlayer={playerWindow.restore}
            onToggleCamera={toggleCamera} onToggleBlur={toggleBlur} onLeave={leaveVoice} onPopout={videoWindows.open} poppedIds={videoWindows.poppedIds} onRestore={videoWindows.restore} />
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
        voice={active.voice} channels={server.channels} friends={friendsMenu} client={client} />}

      {showAdmin && server && <AdminPanel api={conn.api} server={server} myUserId={active.userId!} directoryUrl={active.directoryUrl} onClose={() => setShowAdmin(false)} />}
      {cameraPick && <CameraPicker cameras={cameraPick} initial={voiceSettings.cameraDeviceId} initialBlur={voiceSettings.cameraBlur} onPick={(id, b) => { void pickCamera(id, b); }} onCancel={() => setCameraPick(null)} />}
      {miniProfile && active.me && (
        <MiniProfile anchor={miniProfile} displayName={me?.displayName ?? active.me.displayName ?? "…"} storedName={active.me.displayName} handle={active.me.handle}
          serverName={server?.settings.name ?? active.serverName} withDirectory={!!state.directoryAccount && !!active.serverDomain}
          onSave={(n) => store.setServerDisplayName(n)} onOpenSettings={() => setSettingsTab("profile")} onClose={() => setMiniProfile(null)} />
      )}
      {settingsTab && active.me && (
        <SettingsDialog api={conn.api} me={active.me} displayName={me?.displayName ?? active.me.displayName ?? "…"} directoryUrl={state.directoryUrl} directoryAccount={state.directoryAccount}
          serverDomain={active.serverDomain} clientVersion={home.serverVersion} syncError={state.settingsSyncError} client={client} voice={voice} initialTab={settingsTab}
          onSaveServerName={(n) => store.setServerDisplayName(n)} onSaveGlobalName={(n) => store.setDirectoryName(null, n)} onSetLocale={(pref) => store.setLocale(pref)}
          onCapturingKey={setCapturingPttKey} onClose={() => setSettingsTab(null)}
          onLogout={() => { setSettingsTab(null); void client.leave(); store.logout(); }}
          onForget={() => { setSettingsTab(null); void client.leave(); void store.forgetIdentity(); }} />
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
