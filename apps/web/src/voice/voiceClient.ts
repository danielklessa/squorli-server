import {
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type LocalTrackPublication,
  type Participant as LkParticipant,
  type RemoteTrack,
} from "livekit-client";
import { BackgroundBlur, supportsBackgroundProcessors, type BackgroundProcessorWrapper } from "@livekit/track-processors";
import { VoiceGate, rmsLevel } from "./gate";
import { MicPipeline, type GateMode } from "./micPipeline";
import type { VoiceSettings } from "./settings";

/**
 * Sprachkanal-Client ohne UI-Abhaengigkeit (PLAN 3.4 "gemeinsamer Kern"): LiveKit-Raum, Mikrofon-Pipeline,
 * Wiedergabe der anderen Teilnehmer, Sprecher-Anzeige, Geraetewahl, Statistiken fuer die Debug-Ansicht.
 * M3: Kamera (Simulcast, adaptiveStream waehlt die Stufe nach Kachelgroesse), Bildschirmfreigabe mit Ton
 * als eigenem Audio-Track (PLAN 3.6), Video-Kacheln fuer die Buehne.
 */
export type VoiceParticipant = {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  /** Ton aus (hoert niemanden); fuer andere ueber LiveKit-Attribute sichtbar. */
  deafened: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  quality: string;
};

/** Ein Videobild fuer die Buehne: Kamera oder Bildschirm eines Teilnehmers. Das Track-Objekt wird per attach() angezeigt. */
export type VideoTile = {
  /** identity + Quelle, stabil ueber Re-Renders */
  id: string;
  identity: string;
  name: string;
  isLocal: boolean;
  source: "camera" | "screen";
  track: LocalVideoTrack | RemoteVideoTrack;
  /** Bildschirm-Ton (nur remote; lokal hoert man sich nicht selbst) */
  audio: RemoteAudioTrack | null;
  /** Bildschirmfreigabe bringt Ton mit (auch lokal bekannt) */
  hasAudio: boolean;
};

export type VoiceStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export type VoiceState = {
  status: VoiceStatus;
  channelId: string | null;
  participants: VoiceParticipant[];
  /** Mikrofon effektiv stumm (von Hand oder weil Ton aus); fuer andere sichtbar. */
  micMuted: boolean;
  /** Ton aus: eingehendes Audio stumm, Mikrofon zwangsweise stumm. */
  deafened: boolean;
  /** Tor der Sprachaktivierung / PTT offen (nur lokal). */
  gateOpen: boolean;
  level: number;
  /** false = Browser blockiert Autoplay; Nutzer muss einmal klicken. */
  canPlayback: boolean;
  /** Zustand des Web-Audio-Kontexts (Mikrofon-Tor, Pegelmessung): "running" ist Pflicht, "suspended" = Browser blockiert bis zur Nutzergeste. */
  audioContext: string;
  inputDeviceId: string | null;
  cameraOn: boolean;
  /** Aktiver Unschaerfe-Radius der Kamera (0 = aus). */
  cameraBlur: number;
  screenOn: boolean;
  /** Nach dem Start einer Bildschirmfreigabe: kam ein Audio-Track mit? null = keine Freigabe aktiv. */
  screenAudio: boolean | null;
  tiles: VideoTile[];
  /** Hinweis eines Moderators (verschoben, Kamera beendet); der Nutzer kann ihn wegklicken. */
  notice: string | null;
  /** Ausgabegeraet fuer Bildschirm-Ton und wie viele Spuren es tragen (Debug). */
  screenSink: { deviceId: string | null; tracks: number; error: string | null };
  /** Aktives Sprachprofil des Kanals (Bitrate kbit/s, Stereo). */
  audioProfile: AudioProfile | null;
  /** Zuletzt benutzte LiveKit-URL (Debug). */
  rtcUrl: string | null;
  /** Letzte Raum-Ereignisse mit Zeit (Debug), neueste zuletzt. */
  events: string[];
  error: string | null;
};

/** 0,1 s Stille (WAV): einmal in einer Nutzergeste abspielen entsperrt die <audio>-Wiedergabe fuer das Dokument. */
const SILENT_WAV = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
/** Sprecher-Rahmen fuer andere: RMS-Schwelle und Nachlauf der lokalen Pegelmessung. */
const REMOTE_SPEAK_THRESHOLD = 0.015;
const REMOTE_SPEAK_HANGOVER_MS = 250;
const EVENTS_MAX = 40;

/** Gewaehlter ICE-Weg je Transportrichtung, z. B. "udp srflx->host" oder "relay (TURN)". */
export type IcePath = { publisher: string | null; subscriber: string | null };

/** Sprachqualitaet des Kanals (Opus-Bitrate in kbit/s, Stereo), kommt aus den Kanaleinstellungen. */
export type AudioProfile = { bitrate: number; stereo: boolean };
export const DEFAULT_AUDIO_PROFILE: AudioProfile = { bitrate: 64, stereo: false };

export type JoinOptions = {
  /** "relay" zwingt den Browser auf TURN (Test fuer gesperrtes UDP/TCP). */
  iceTransportPolicy?: "all" | "relay";
  audio?: AudioProfile;
};

export type VideoSendStat = { source: "camera" | "screen"; rid: string; width: number; height: number; fps: number; bytesSent: number; limitation?: string | undefined };
export type VideoRecvStat = { identity: string; source: "camera" | "screen"; width?: number | undefined; height?: number | undefined; framesDecoded: number; bytesReceived: number; packetsLost?: number | undefined };

export type AudioStats = {
  path: IcePath;
  sender: { packetsSent?: number | undefined; packetsLost?: number | undefined; jitter?: number | undefined; roundTripTime?: number | undefined; bytesSent?: number | undefined } | null;
  receivers: { identity: string; packetsReceived?: number | undefined; packetsLost?: number | undefined; jitter?: number | undefined; bytesReceived?: number | undefined }[];
  /** M3: je Simulcast-Stufe (rid) beim Senden, je Spur beim Empfang. Bytes sind kumuliert; Bitrate = Differenz je Intervall. */
  videoSend: VideoSendStat[];
  videoRecv: VideoRecvStat[];
};

/** Chromium-Browser koennen Tab-/Systemton bei der Bildschirmfreigabe mitliefern; alle anderen nicht (PLAN 3.6). */
export const isChromium = () => typeof (window as { chrome?: unknown }).chrome !== "undefined";

/** Erklaert, warum eine Bildschirmfreigabe ohne Ton laeuft; leer, wenn Ton dabei ist oder keine Freigabe aktiv. */
export function explainScreenAudio(state: Pick<VoiceState, "screenOn" | "screenAudio">): string {
  if (!state.screenOn || state.screenAudio !== false) return "";
  return isChromium()
    ? "Bildschirm wird ohne Ton geteilt. Ton kommt nur mit, wenn im Browser-Dialog ein Tab (\"Tab-Audio teilen\") oder unter Windows der ganze Bildschirm mit \"Systemaudio teilen\" gewählt wird; einzelne Fenster liefern keinen Ton."
    : "Bildschirm wird ohne Ton geteilt: dieser Browser liefert bei der Bildschirmfreigabe keinen Ton. Mit Ton geht es in Chrome, Edge oder Brave.";
}

export class VoiceClient {
  private room: Room | null = null;
  private mic: MicPipeline | null = null;
  private publication: LocalTrackPublication | null = null;
  private readonly audioHost: HTMLElement;
  private readonly listeners = new Set<(s: VoiceState) => void>();
  state: VoiceState = {
    status: "disconnected", channelId: null, participants: [], micMuted: false, deafened: false, gateOpen: false, level: 0,
    canPlayback: true, audioContext: "none", inputDeviceId: null, cameraOn: false, cameraBlur: 0, screenOn: false, screenAudio: null, tiles: [], notice: null, screenSink: { deviceId: null, tracks: 0, error: null }, audioProfile: null, rtcUrl: null, events: [], error: null,
  };
  private audioProfile: AudioProfile = DEFAULT_AUDIO_PROFILE;
  private micSettings: VoiceSettings | null = null;
  /** Ausgabegeraet fuer Bildschirm-Ton (getrennt von der Sprache); null = Standard/wie Sprache. */
  private screenSinkId: string | null = null;
  /** Vom Nutzer selbst gesetzte Mikrofon-Stummschaltung, unabhaengig von "Ton aus". */
  private micMutedByUser = false;
  /** Zuletzt gewuenschte Kamera-Einstellungen (fuer erneutes Einschalten). */
  private camera: { deviceId: string | null; quality: "360p" | "720p"; blur: number } = { deviceId: null, quality: "720p", blur: 0 };
  /** Hintergrund-Prozessor (MediaPipe-Segmentierung, laeuft im Browser); bleibt fuer Umschalten erhalten. */
  private blur: BackgroundProcessorWrapper | null = null;
  /** Ein AudioContext fuer alles (Mikrofon-Tor, Pegel der anderen); in einer Nutzergeste angelegt, siehe prepareAudio(). */
  private audioCtx: AudioContext | null = null;
  private unlocked = false;
  /** Pegelmesser je entfernter Mikrofon-Spur: Sprecher-Rahmen ohne die Verzoegerung der LiveKit-Meldung (~0,5-1 s). */
  private readonly meters = new Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; gate: VoiceGate; samples: Float32Array<ArrayBuffer> }>();
  private meterTimer: number | null = null;

  constructor(audioHost?: HTMLElement) {
    this.audioHost = audioHost ?? VoiceClient.makeHost();
    // Fallback: jede Geste im Dokument darf blockiertes Audio nachtraeglich freigeben (Kontext fortsetzen, Wiedergabe starten).
    document.addEventListener("pointerdown", () => this.unlockOnGesture(), { capture: true, passive: true });
    document.addEventListener("keydown", () => this.unlockOnGesture(), { capture: true, passive: true });
  }

  /**
   * Im Klick-Handler VOR dem ersten await aufrufen (App.joinVoice): legt den AudioContext in der Nutzergeste an und spielt
   * einmal Stille, damit Browser mit strenger Autoplay-Regel (Safari, teils Firefox) Mikrofon-Tor und Wiedergabe freigeben.
   * Ohne das entstand der Kontext erst nach Token und Verbindung: Pegel blieb 0 (niemand hoerte einen) und <audio> blieb stumm.
   */
  prepareAudio(): void {
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (!this.unlocked) {
      const el = document.createElement("audio");
      el.src = SILENT_WAV;
      el.play().then(() => { this.unlocked = true; }).catch(() => { /* keine Geste: spaeter erneut */ });
    }
    if (this.room && !this.room.canPlaybackAudio) void this.startAudio();
    this.patch({ audioContext: ctx.state });
  }

  private ensureCtx(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === "closed") {
      this.audioCtx = new AudioContext();
      this.audioCtx.onstatechange = () => this.patch({ audioContext: this.audioCtx?.state ?? "none" });
    }
    return this.audioCtx;
  }

  private unlockOnGesture(): void {
    const ctx = this.audioCtx;
    if (ctx && ctx.state === "suspended") void ctx.resume().then(() => this.log("audio-kontext freigegeben (klick)")).catch(() => {});
    if (this.room && !this.room.canPlaybackAudio) void this.startAudio();
  }

  private static makeHost() {
    const el = document.createElement("div");
    el.id = "voice-audio";
    el.style.display = "none";
    document.body.appendChild(el);
    return el;
  }

  subscribe(fn: (s: VoiceState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private patch(p: Partial<VoiceState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }

  private log(text: string) {
    const line = `${new Date().toLocaleTimeString()} ${text}`;
    this.patch({ events: [...this.state.events.slice(-(EVENTS_MAX - 1)), line] });
  }

  async join(channelId: string, url: string, token: string, settings: VoiceSettings, opts: JoinOptions = {}): Promise<void> {
    if (this.room) await this.leave();
    this.audioProfile = opts.audio ?? DEFAULT_AUDIO_PROFILE;
    this.micSettings = settings;
    this.patch({ status: "connecting", channelId, rtcUrl: url, error: null, audioProfile: this.audioProfile });

    // adaptiveStream: Empfangsqualitaet je nach Groesse des <video>-Elements (Simulcast-Stufe), pausiert unsichtbare Spuren.
    // dynacast: Sender schaltet Stufen ab, die niemand abonniert hat. Zusammen: PLAN M3 "Simulcast-Stufen je nach Kachelgroesse".
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        videoCodec: "vp8", // ueberall decodierbar, kein Backup-Codec noetig
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding, // 1080p, 30 fps, bis 5 Mbit/s
        dtx: true,
        red: true,
      },
    });
    this.room = room;
    this.log(`verbinde mit ${url}${opts.iceTransportPolicy === "relay" ? " (nur TURN/relay)" : ""}`);
    room
      .on(RoomEvent.ParticipantConnected, (p) => { this.log(`teilnehmer da: ${p.identity.slice(0, 8)}`); this.refreshParticipants(); })
      .on(RoomEvent.ParticipantDisconnected, (p) => { this.log(`teilnehmer weg: ${p.identity.slice(0, 8)}`); this.refreshParticipants(); })
      .on(RoomEvent.Reconnecting, () => this.log("verbindung unterbrochen, versuche erneut"))
      .on(RoomEvent.Reconnected, () => this.log("wieder verbunden"))
      .on(RoomEvent.MediaDevicesError, (e) => this.log(`Gerätefehler: ${e.message}`))
      .on(RoomEvent.ActiveSpeakersChanged, () => this.refreshParticipants())
      .on(RoomEvent.TrackMuted, () => this.refreshParticipants())
      .on(RoomEvent.TrackUnmuted, () => this.refreshParticipants())
      .on(RoomEvent.ConnectionQualityChanged, () => this.refreshParticipants())
      .on(RoomEvent.ParticipantAttributesChanged, () => this.refreshParticipants())
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => { this.attachRemote(track, p.identity); if (track.kind === Track.Kind.Video) this.log(`video von ${p.identity.slice(0, 8)}: ${track.source}`); this.refreshTiles(); })
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => { if (track.kind === Track.Kind.Audio) { track.detach().forEach((el) => el.remove()); this.dropMeter(p.identity); } this.refreshTiles(); })
      .on(RoomEvent.LocalTrackPublished, (pub) => { this.log(`sende ${pub.source}`); this.refreshTiles(); })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        this.log(`beendet ${pub.source}`);
        // Auch wenn der Browser die Freigabe selbst beendet ("Freigabe beenden"-Leiste) hier landen.
        if (pub.source === Track.Source.ScreenShare) this.patch({ screenOn: false, screenAudio: null });
        if (pub.source === Track.Source.Camera) this.patch({ cameraOn: false });
        this.refreshTiles();
      })
      .on(RoomEvent.TrackStreamStateChanged, () => this.refreshTiles())
      // LiveKit setzt bei Geraetewechseln alle Audio-Spuren auf das Sprach-Ausgabegeraet; Bildschirm-Ton danach wieder trennen.
      .on(RoomEvent.MediaDevicesChanged, () => { void this.applyScreenSink(); })
      .on(RoomEvent.ActiveDeviceChanged, (kind) => { if (kind === "audiooutput") void this.applyScreenSink(); })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.patch({ canPlayback: room.canPlaybackAudio }))
      .on(RoomEvent.ConnectionStateChanged, (s) => { this.log(`status: ${s}`); this.patch({ status: mapState(s) }); })
      .on(RoomEvent.Disconnected, (reason) => {
        const why = explainDisconnect(reason);
        this.log(`getrennt: ${why.short}`);
        void this.leave().then(() => { if (why.unexpected) this.patch({ error: why.long }); });
      });

    try {
      await room.connect(url, token, opts.iceTransportPolicy ? { rtcConfig: { iceTransportPolicy: opts.iceTransportPolicy } } : {});
      // Mikrofon erst nach Verbindung, damit ein Verbindungsfehler nicht auch noch eine Berechtigungsfrage kostet.
      const mic = new MicPipeline(settings.vadThreshold, settings.vadHangoverMs, this.ensureCtx());
      this.mic = mic;
      mic.onState = (s) => {
        const changed = s.open !== this.state.gateOpen;
        this.patch({ level: s.level, gateOpen: s.open });
        if (changed) this.refreshParticipants(); // eigener Sprecher-Rahmen sofort, nicht erst mit LiveKits Meldung
      };
      mic.setMode(settings.mode);
      const track = await mic.start(settings.inputDeviceId, this.audioProfile.stereo);
      this.publication = await room.localParticipant.publishTrack(track, this.micPublishOptions());
      this.log(`opus ${this.audioProfile.bitrate} kbit/s ${this.audioProfile.stereo ? "stereo" : "mono, dtx+red"}`);
      if (settings.outputDeviceId) await this.setOutputDevice(settings.outputDeviceId).catch(() => {});
      this.screenSinkId = settings.screenOutputDeviceId;
      this.micMutedByUser = false;
      this.patch({ status: mapState(room.state), canPlayback: room.canPlaybackAudio, audioContext: mic.contextState(), inputDeviceId: mic.activeDeviceId(), micMuted: false, deafened: false });
      this.log(`audio-kontext ${mic.contextState()}, wiedergabe ${room.canPlaybackAudio ? "frei" : "blockiert (klicken)"}`);
      this.startMeters();
      this.refreshParticipants();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.leave();
      this.patch({ error: explainConnectError(message, url), rtcUrl: url });
      throw err;
    }
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.publication = null;
    this.stopMeters();
    await this.mic?.stop();
    this.mic = null;
    if (room) {
      room.removeAllListeners();
      await room.disconnect().catch(() => {});
    }
    this.audioHost.replaceChildren();
    this.micMutedByUser = false;
    this.patch({ status: "disconnected", channelId: null, participants: [], gateOpen: false, level: 0, micMuted: false, deafened: false, inputDeviceId: null, cameraOn: false, screenOn: false, screenAudio: null, tiles: [] });
  }

  // ---------- Kamera und Bildschirm (M3)

  async setCameraEnabled(on: boolean, deviceId?: string | null, quality?: "360p" | "720p", blur?: number): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (deviceId !== undefined) this.camera.deviceId = deviceId;
    if (quality) this.camera.quality = quality;
    if (blur !== undefined) this.camera.blur = blur;
    try {
      const resolution = (this.camera.quality === "360p" ? VideoPresets.h360 : VideoPresets.h720).resolution;
      if (!on) this.blur = null; // Track wird beendet, der Prozessor mit ihm
      await room.localParticipant.setCameraEnabled(on, on ? { resolution, ...(this.camera.deviceId ? { deviceId: this.camera.deviceId } : {}) } : undefined);
      this.patch({ cameraOn: on, cameraBlur: 0, error: null });
      if (on && this.camera.blur > 0) await this.setCameraBlur(this.camera.blur);
    } catch (err) {
      if (!isUserCancel(err)) this.patch({ error: `Kamera: ${errorText(err)}` });
      this.patch({ cameraOn: room.localParticipant.isCameraEnabled });
    }
    this.refreshTiles();
    this.refreshParticipants();
  }

  /** Kann dieser Browser den Hintergrund weichzeichnen (WebGL2/WASM, MediaStreamTrackProcessor)? */
  static supportsBlur(): boolean { try { return supportsBackgroundProcessors(); } catch { return false; } }

  /** Hintergrund-Unschaerfe der laufenden Kamera setzen (0 = aus). Modell/WASM laedt beim ersten Mal aus dem Netz (jsdelivr, Google Storage). */
  async setCameraBlur(radius: number): Promise<void> {
    this.camera.blur = radius;
    const track = this.room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (!(track instanceof LocalVideoTrack)) return;
    try {
      if (radius <= 0) {
        if (this.blur) { await track.stopProcessor(); this.blur = null; }
      } else if (this.blur) {
        await this.blur.switchTo({ mode: "background-blur", blurRadius: radius });
      } else {
        this.blur = BackgroundBlur(radius);
        await track.setProcessor(this.blur);
      }
      this.patch({ cameraBlur: radius, error: null });
      this.log(radius > 0 ? `hintergrund unscharf (${radius})` : "hintergrund normal");
    } catch (err) {
      this.blur = null;
      this.patch({ cameraBlur: 0, error: `Hintergrund-Unschärfe: ${errorText(err)}` });
    }
  }

  /** Opus-Einstellungen aus dem Kanalprofil: Bitrate; Mono mit DTX (Stille kostet nichts) und RED (Redundanz gegen Verlust). */
  private micPublishOptions() {
    const p = this.audioProfile;
    return {
      source: Track.Source.Microphone,
      name: "microphone",
      audioBitrate: p.bitrate * 1000,
      dtx: !p.stereo,
      red: !p.stereo,
      forceStereo: p.stereo,
    };
  }

  /** Kanalprofil hat sich geaendert (Verwaltung): Mikrofon mit neuen Opus-Parametern neu publizieren. */
  async setAudioProfile(profile: AudioProfile): Promise<void> {
    const same = profile.bitrate === this.audioProfile.bitrate && profile.stereo === this.audioProfile.stereo;
    this.audioProfile = profile;
    this.patch({ audioProfile: profile });
    const room = this.room; const mic = this.mic; const pub = this.publication;
    if (same || !room || !mic || !pub || !this.micSettings) return;
    try {
      const wasMuted = this.state.micMuted;
      if (pub.track) await room.localParticipant.unpublishTrack(pub.track, false);
      const track = await mic.start(this.micSettings.inputDeviceId, profile.stereo);
      this.publication = await room.localParticipant.publishTrack(track, this.micPublishOptions());
      if (wasMuted && this.publication.track instanceof LocalAudioTrack) await this.publication.track.mute();
      this.log(`opus umgestellt: ${profile.bitrate} kbit/s ${profile.stereo ? "stereo" : "mono"}`);
    } catch (err) {
      this.patch({ error: `Sprachprofil: ${errorText(err)}` });
    }
  }

  async setCameraDevice(deviceId: string | null): Promise<void> {
    this.camera.deviceId = deviceId;
    if (this.state.cameraOn && this.room) await this.room.switchActiveDevice("videoinput", deviceId ?? "default").catch(() => {});
  }

  /** Bildschirm teilen; Ton wird immer angefordert und als eigener Track publiziert (PLAN 3.6). Ob er kommt, entscheidet der Browser. */
  async setScreenShareEnabled(on: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      // Kein Simulcast fuer den Bildschirm: adaptiveStream wuerde bei kleinen Kacheln die grobe Stufe holen und beim
      // Vergroessern erst nach Sekunden hochschalten; Text braucht die volle Stufe. contentHint "detail" haelt die
      // Aufloesung und opfert bei Engpaessen lieber Bilder pro Sekunde.
      await room.localParticipant.setScreenShareEnabled(on, on ? {
        audio: true,
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        contentHint: "detail",
        resolution: ScreenSharePresets.h1080fps30.resolution,
      } : undefined, on ? { simulcast: false, videoEncoding: ScreenSharePresets.h1080fps30.encoding } : undefined);
      const hasAudio = on && !!room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
      this.patch({ screenOn: on && room.localParticipant.isScreenShareEnabled, screenAudio: on ? hasAudio : null, error: null });
      if (on) this.log(hasAudio ? "bildschirm mit ton" : "bildschirm ohne ton");
    } catch (err) {
      // Abbruch im Auswahldialog ist kein Fehler.
      if (!isUserCancel(err)) this.patch({ error: `Bildschirmfreigabe: ${errorText(err)}` });
      this.patch({ screenOn: room.localParticipant.isScreenShareEnabled });
    }
    this.refreshTiles();
    this.refreshParticipants();
  }

  /** Lautstaerke des Bildschirm-Tons eines Teilnehmers (0..1); getrennt vom Mikrofon regelbar. */
  setScreenAudioVolume(identity: string, volume: number): void {
    const tile = this.state.tiles.find((t) => t.identity === identity && t.source === "screen");
    tile?.audio?.setVolume(volume);
  }

  private refreshTiles() {
    const room = this.room;
    if (!room) return;
    const tiles: VideoTile[] = [];
    const all: LkParticipant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    for (const p of all) {
      const isLocal = p === room.localParticipant;
      const cam = p.getTrackPublication(Track.Source.Camera)?.track;
      if ((cam instanceof LocalVideoTrack || cam instanceof RemoteVideoTrack) && !cam.isMuted) {
        tiles.push({ id: `${p.identity}:camera`, identity: p.identity, name: p.name || p.identity, isLocal, source: "camera", track: cam, audio: null, hasAudio: false });
      }
      const scr = p.getTrackPublication(Track.Source.ScreenShare)?.track;
      if (scr instanceof LocalVideoTrack || scr instanceof RemoteVideoTrack) {
        const audioPub = p.getTrackPublication(Track.Source.ScreenShareAudio);
        const audio = audioPub?.track instanceof RemoteAudioTrack ? audioPub.track : null;
        tiles.push({ id: `${p.identity}:screen`, identity: p.identity, name: p.name || p.identity, isLocal, source: "screen", track: scr, audio, hasAudio: !!audioPub });
      }
    }
    this.patch({ tiles });
  }

  /** Browser-Autoplay-Sperre aufheben; muss aus einer Nutzeraktion heraus aufgerufen werden. */
  async startAudio(): Promise<void> {
    await this.room?.startAudio();
    this.patch({ canPlayback: this.room?.canPlaybackAudio ?? true });
  }

  /**
   * Mikrofon von Hand stumm/an. Bei "Ton aus" hebt ein Klick aufs Mikrofon beides auf (wie bei Discord),
   * denn ein aktives Mikrofon bei ausgeschaltetem Ton ergibt keinen Sinn.
   */
  async setMuted(muted: boolean): Promise<void> {
    if (!muted && this.state.deafened) { this.micMutedByUser = false; await this.setDeafened(false); return; }
    this.micMutedByUser = muted;
    await this.applyMic();
  }

  /**
   * Ton aus/an ("deafen"): eingehendes Audio stumm, Mikrofon zwangsweise stumm. Beim Einschalten des Tons
   * bleibt das Mikrofon nur stumm, wenn es vorher von Hand stummgeschaltet war.
   */
  async setDeafened(on: boolean): Promise<void> {
    this.patch({ deafened: on });
    for (const el of this.audioHost.querySelectorAll("audio")) el.muted = on;
    await this.applyMic();
    await this.room?.localParticipant.setAttributes({ deafened: on ? "1" : "" }).catch(() => {});
    this.log(on ? "ton aus (mikrofon mit stumm)" : `ton an (mikrofon ${this.micMutedByUser ? "bleibt stumm" : "wieder an"})`);
    this.refreshParticipants();
  }

  private async applyMic(): Promise<void> {
    const muted = this.micMutedByUser || this.state.deafened;
    const track = this.publication?.track;
    if (track instanceof LocalAudioTrack) {
      if (muted) await track.mute(); else await track.unmute();
    }
    this.patch({ micMuted: muted });
    this.refreshParticipants();
  }

  setMode(mode: GateMode) { this.mic?.setMode(mode); }
  setThreshold(t: number) { this.mic?.setThreshold(t); }
  setHangover(ms: number) { this.mic?.setHangover(ms); }
  setPttHeld(held: boolean) { this.mic?.setPttHeld(held); }

  async setInputDevice(deviceId: string | null): Promise<void> {
    if (!this.mic || !this.publication) return;
    const track = await this.mic.start(deviceId, this.audioProfile.stereo);
    const local = this.publication.track;
    if (local instanceof LocalAudioTrack) await local.replaceTrack(track, true);
    this.patch({ inputDeviceId: this.mic.activeDeviceId() });
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    await this.room?.switchActiveDevice("audiooutput", deviceId);
    // LiveKit setzt das Geraet fuer alle Spuren; Bildschirm-Ton danach wieder auf sein eigenes Geraet legen.
    await this.applyScreenSink();
  }

  /** Bildschirm-Ton auf ein eigenes Ausgabegeraet (z. B. Lautsprecher statt Headset). Nur Chromium; sonst wirkungslos. */
  async setScreenOutputDevice(deviceId: string | null): Promise<void> {
    this.screenSinkId = deviceId;
    await this.applyScreenSink();
  }

  private async applyScreenSink(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const fallback = room.getActiveDevice("audiooutput") ?? "";
    const target = this.screenSinkId ?? fallback;
    let tracks = 0; let error: string | null = null;
    for (const p of room.remoteParticipants.values()) {
      const t = p.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
      if (!(t instanceof RemoteAudioTrack)) continue;
      tracks++;
      try { await t.setSinkId(target); } catch (err) { error = errorText(err); }
    }
    this.patch({ screenSink: { deviceId: this.screenSinkId, tracks, error } });
    if (tracks || error) this.log(`bildschirm-ton -> ${this.screenSinkId ? `geraet ${this.screenSinkId.slice(0, 8)}` : "wie sprache"} (${tracks} spuren${error ? `, fehler: ${error}` : ""})`);
  }

  setNotice(text: string | null) { this.patch({ notice: text }); if (text) this.log(`hinweis: ${text}`); }

  /** requestCamera = true fragt einmal nach Kameraberechtigung, damit die Geraetenamen lesbar sind (fuer die Auswahl beim Einschalten). */
  static async listDevices(requestCamera = false): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }> {
    const [inputs, outputs, cameras] = await Promise.all([
      Room.getLocalDevices("audioinput", false),
      Room.getLocalDevices("audiooutput", false),
      Room.getLocalDevices("videoinput", requestCamera),
    ]);
    return { inputs, outputs, cameras };
  }

  async stats(): Promise<AudioStats> {
    const room = this.room;
    if (!room) return { path: { publisher: null, subscriber: null }, sender: null, receivers: [], videoSend: [], videoRecv: [] };
    const pm = room.engine.pcManager;
    const path: IcePath = {
      publisher: pm ? await icePathOf(pm.publisher.getStats()) : null,
      subscriber: pm?.subscriber ? await icePathOf(pm.subscriber.getStats()) : null,
    };
    const local = this.publication?.track;
    const sender = local instanceof LocalAudioTrack ? (await local.getSenderStats()) ?? null : null;
    const receivers: AudioStats["receivers"] = [];
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        const t = pub.track;
        if (t instanceof RemoteAudioTrack) {
          const s = await t.getReceiverStats();
          receivers.push({ identity: p.identity, packetsReceived: s?.packetsReceived, packetsLost: s?.packetsLost, jitter: s?.jitter, bytesReceived: s?.bytesReceived });
        }
      }
    }
    const videoSend: VideoSendStat[] = [];
    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      const t = pub.track;
      if (!(t instanceof LocalVideoTrack)) continue;
      const source = pub.source === Track.Source.ScreenShare ? "screen" : "camera";
      for (const s of (await t.getSenderStats().catch(() => [])) ?? []) {
        videoSend.push({ source, rid: s.rid || "-", width: s.frameWidth, height: s.frameHeight, fps: s.framesPerSecond, bytesSent: s.bytesSent ?? 0, limitation: s.qualityLimitationReason });
      }
    }
    const videoRecv: VideoRecvStat[] = [];
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.videoTrackPublications.values()) {
        const t = pub.track;
        if (!(t instanceof RemoteVideoTrack)) continue;
        const s = await t.getReceiverStats().catch(() => undefined);
        if (s) videoRecv.push({ identity: p.identity, source: pub.source === Track.Source.ScreenShare ? "screen" : "camera", width: s.frameWidth, height: s.frameHeight, framesDecoded: s.framesDecoded, bytesReceived: s.bytesReceived ?? 0, packetsLost: s.packetsLost });
      }
    }
    return { path, sender, receivers, videoSend, videoRecv };
  }

  private attachRemote(track: RemoteTrack, identity: string) {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.muted = this.state.deafened; // "Ton aus" gilt auch fuer Spuren, die spaeter dazukommen
    this.audioHost.appendChild(el);
    if (track.source === Track.Source.ScreenShareAudio) void this.applyScreenSink();
    if (track.source === Track.Source.Microphone) this.addMeter(identity, track.mediaStreamTrack);
    this.patch({ canPlayback: this.room?.canPlaybackAudio ?? true });
  }

  // ---- Sprecher-Erkennung lokal: RMS je entfernter Mikrofon-Spur alle 50 ms, Tor mit Nachlauf (wie die eigene VAD).
  // LiveKits ActiveSpeakersChanged kommt vom Server geglaettet (~0,5-1 s spaeter) und dient nur noch als Rueckfall.
  private addMeter(identity: string, mst: MediaStreamTrack) {
    this.dropMeter(identity);
    try {
      const ctx = this.ensureCtx();
      const source = ctx.createMediaStreamSource(new MediaStream([mst]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // nicht an destination: die Wiedergabe laeuft weiter ueber das <audio>-Element
      this.meters.set(identity, { source, analyser, gate: new VoiceGate(REMOTE_SPEAK_THRESHOLD, REMOTE_SPEAK_HANGOVER_MS), samples: new Float32Array(analyser.fftSize) });
    } catch (err) {
      this.log(`pegelmesser fuer ${identity.slice(0, 8)} nicht moeglich: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  private dropMeter(identity: string) {
    const m = this.meters.get(identity);
    if (!m) return;
    m.source.disconnect(); m.analyser.disconnect();
    this.meters.delete(identity);
  }
  private startMeters() {
    this.stopMeters();
    this.meterTimer = window.setInterval(() => {
      if (this.audioCtx?.state !== "running") return; // ohne laufenden Kontext gilt LiveKits Meldung (siehe refreshParticipants)
      const now = performance.now();
      let changed = false;
      for (const m of this.meters.values()) {
        m.analyser.getFloatTimeDomainData(m.samples);
        const before = m.gate.isOpen();
        if (m.gate.update(rmsLevel(m.samples), now) !== before) changed = true;
      }
      if (changed) this.refreshParticipants();
    }, 50);
  }
  private stopMeters() {
    if (this.meterTimer !== null) { clearInterval(this.meterTimer); this.meterTimer = null; }
    for (const id of [...this.meters.keys()]) this.dropMeter(id);
  }

  private refreshParticipants() {
    const room = this.room;
    if (!room) return;
    const all: LkParticipant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const participants = all.map((p) => ({
      identity: p.identity,
      name: p.name || p.identity,
      isLocal: p === room.localParticipant,
      speaking: p === room.localParticipant
        ? this.state.gateOpen && !this.state.micMuted
        : (this.audioCtx?.state === "running" && this.meters.get(p.identity)?.gate.isOpen()) ?? p.isSpeaking,
      micMuted: p === room.localParticipant ? this.state.micMuted : !p.isMicrophoneEnabled,
      deafened: p === room.localParticipant ? this.state.deafened : p.attributes?.deafened === "1",
      cameraOn: p.isCameraEnabled,
      screenOn: p.isScreenShareEnabled,
      quality: String(p.connectionQuality),
    }));
    this.patch({ participants });
  }
}

/** Aus WebRTC-Statistiken den aktiven Kandidatenweg lesen: Protokoll und Kandidatentypen (host/srflx/prflx/relay). */
async function icePathOf(statsPromise: Promise<RTCStatsReport> | undefined): Promise<string | null> {
  const stats = await statsPromise?.catch(() => undefined);
  if (!stats) return null;
  type Pair = { type: string; state?: string; nominated?: boolean; selected?: boolean; localCandidateId?: string; remoteCandidateId?: string };
  type Cand = { type: string; candidateType?: string; protocol?: string; relayProtocol?: string };
  let pair: Pair | undefined;
  stats.forEach((s: Pair) => {
    if (s.type === "candidate-pair" && s.state === "succeeded" && (s.nominated || s.selected)) pair ??= s;
  });
  if (!pair) return null;
  const local = pair.localCandidateId ? (stats.get(pair.localCandidateId) as Cand | undefined) : undefined;
  const remote = pair.remoteCandidateId ? (stats.get(pair.remoteCandidateId) as Cand | undefined) : undefined;
  if (!local) return null;
  if (local.candidateType === "relay") return `relay (TURN über ${local.relayProtocol ?? local.protocol ?? "?"})`;
  return `${local.protocol ?? "?"} ${local.candidateType ?? "?"}->${remote?.candidateType ?? "?"}`;
}

/** Trennungsgrund von LiveKit erklaeren; unexpected = dem Nutzer als Fehler zeigen. */
function explainDisconnect(reason: DisconnectReason | undefined): { short: string; long: string; unexpected: boolean } {
  const name = reason === undefined ? "unbekannt" : DisconnectReason[reason] ?? String(reason);
  const media = "Die Medienverbindung (ICE) kam nicht zustande oder brach ab. Prüfen: 7882/udp und 7881/tcp am Router zum Chat-Host, " +
    "LiveKit kennt seine öffentliche IP (LIVEKIT_NODE_IP)? Der Dev-Stack (compose.dev.yml) bietet 127.0.0.1 an und ist von außen nie erreichbar.";
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED: return { short: name, long: "", unexpected: false };
    case DisconnectReason.DUPLICATE_IDENTITY: return { short: name, long: "Getrennt: dieselbe Identität ist von einem anderen Gerät/Tab beigetreten.", unexpected: true };
    case DisconnectReason.SIGNAL_CLOSE: return { short: name, long: "Getrennt: die Signalverbindung (/rtc WebSocket) wurde geschlossen. Ursachen: Proxy-Timeout auf /rtc (proxy_read_timeout), Netzwechsel, App im Hintergrund/Bildschirm gesperrt.", unexpected: true };
    case DisconnectReason.CONNECTION_TIMEOUT:
    case DisconnectReason.JOIN_FAILURE:
    case DisconnectReason.STATE_MISMATCH:
    case DisconnectReason.UNKNOWN_REASON:
    case undefined:
      return { short: name, long: `Getrennt (${name}). ${media}`, unexpected: true };
    default:
      return { short: name, long: `Getrennt durch den Server (${name}).`, unexpected: true };
  }
}

/** Verbindungsfehler in einen Satz mit Ursache und naechstem Schritt uebersetzen. */
function explainConnectError(message: string, url: string): string {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const pageIsHttps = window.location.protocol === "https:";
  if (host === "localhost" || host === "127.0.0.1") {
    return `${message}. Der Server hat als LiveKit-Adresse "${url}" ausgegeben; das ist die Dev-Einstellung (LIVEKIT_PUBLIC_URL) und von anderen Geräten aus nicht erreichbar. ` +
      `Auf dem Server LIVEKIT_PUBLIC_URL entfernen (Standard: wss://PUBLIC_DOMAIN) oder auf die öffentliche Adresse setzen.`;
  }
  if (pageIsHttps && url.startsWith("ws://")) {
    return `${message}. Diese Seite läuft über HTTPS, die LiveKit-Adresse "${url}" aber über ws:// (unverschlüsselt); Browser blockieren das. LIVEKIT_PUBLIC_URL auf wss:// umstellen.`;
  }
  return `${message} (LiveKit-Adresse: ${url}). Prüfen: ${url.replace(/^ws/, "http")}/rtc/validate muss im Browser 401 liefern; sonst leitet der Proxy /rtc nicht weiter.`;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** Nutzer hat den Browser-Dialog (Kamera-/Bildschirmauswahl) abgebrochen. */
const isUserCancel = (err: unknown) => err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");

function mapState(s: ConnectionState): VoiceStatus {
  switch (s) {
    case ConnectionState.Connected: return "connected";
    case ConnectionState.Connecting: return "connecting";
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting: return "reconnecting";
    default: return "disconnected";
  }
}
