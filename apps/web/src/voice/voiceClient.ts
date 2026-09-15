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
import { t } from "../i18n";

/**
 * Voice channel client without a UI dependency (PLAN 3.4 "shared core"): LiveKit room, microphone pipeline,
 * playback of the other participants, speaker indication, device selection, statistics for the debug view.
 * M3: camera (simulcast, adaptiveStream picks the layer by tile size), screen sharing with audio
 * as its own audio track (PLAN 3.6), video tiles for the stage.
 */
export type VoiceParticipant = {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  /** Deafened (hears nobody); visible to others via LiveKit attributes. */
  deafened: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  quality: string;
};

/** One video feed for the stage: a participant's camera or screen. The track object is displayed via attach(). */
export type VideoTile = {
  /** identity + source, stable across re-renders */
  id: string;
  identity: string;
  name: string;
  isLocal: boolean;
  source: "camera" | "screen";
  track: LocalVideoTrack | RemoteVideoTrack;
  /** Screen audio (remote only; locally you do not hear yourself) */
  audio: RemoteAudioTrack | null;
  /** The screen share carries audio (known locally as well) */
  hasAudio: boolean;
};

export type VoiceStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export type VoiceState = {
  status: VoiceStatus;
  channelId: string | null;
  participants: VoiceParticipant[];
  /** Microphone effectively muted (manually or because of deafening); visible to others. */
  micMuted: boolean;
  /** Deafened: incoming audio muted, microphone forcibly muted. */
  deafened: boolean;
  /** Voice activation / PTT gate open (local only). */
  gateOpen: boolean;
  level: number;
  /** false = the browser blocks autoplay; the user has to click once. */
  canPlayback: boolean;
  /** State of the Web Audio context (microphone gate, level metering): "running" is mandatory, "suspended" = the browser blocks until a user gesture. */
  audioContext: string;
  inputDeviceId: string | null;
  cameraOn: boolean;
  /** Active blur radius of the camera (0 = off). */
  cameraBlur: number;
  screenOn: boolean;
  /** After starting a screen share: did an audio track come along? null = no share active. */
  screenAudio: boolean | null;
  tiles: VideoTile[];
  /** Notice from a moderator (moved, camera stopped); the user can dismiss it. */
  notice: string | null;
  /** Output device for screen audio and how many tracks it carries (debug). */
  screenSink: { deviceId: string | null; tracks: number; error: string | null };
  /** Active voice profile of the channel (bitrate in kbit/s, stereo). */
  audioProfile: AudioProfile | null;
  /** Last used LiveKit URL (debug). */
  rtcUrl: string | null;
  /** Recent room events with timestamps (debug), newest last. */
  events: string[];
  error: string | null;
};

/** 0.1 s of silence (WAV): playing it once inside a user gesture unlocks <audio> playback for the document. */
const SILENT_WAV = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
/** Speaker highlight for others: RMS threshold and hangover of the local level metering. */
const REMOTE_SPEAK_THRESHOLD = 0.015;
const REMOTE_SPEAK_HANGOVER_MS = 250;
const EVENTS_MAX = 40;

/** Selected ICE path per transport direction, e.g. "udp srflx->host" or "relay (TURN)". */
export type IcePath = { publisher: string | null; subscriber: string | null };

/** Voice quality of the channel (Opus bitrate in kbit/s, stereo), coming from the channel settings. */
export type AudioProfile = { bitrate: number; stereo: boolean };
export const DEFAULT_AUDIO_PROFILE: AudioProfile = { bitrate: 64, stereo: false };

export type JoinOptions = {
  /** "relay" forces the browser onto TURN (a test for blocked UDP/TCP). */
  iceTransportPolicy?: "all" | "relay";
  audio?: AudioProfile;
};

export type VideoSendStat = { source: "camera" | "screen"; rid: string; width: number; height: number; fps: number; bytesSent: number; limitation?: string | undefined };
export type VideoRecvStat = { identity: string; source: "camera" | "screen"; width?: number | undefined; height?: number | undefined; framesDecoded: number; bytesReceived: number; packetsLost?: number | undefined };

export type AudioStats = {
  path: IcePath;
  sender: { packetsSent?: number | undefined; packetsLost?: number | undefined; jitter?: number | undefined; roundTripTime?: number | undefined; bytesSent?: number | undefined } | null;
  receivers: { identity: string; packetsReceived?: number | undefined; packetsLost?: number | undefined; jitter?: number | undefined; bytesReceived?: number | undefined }[];
  /** M3: per simulcast layer (rid) when sending, per track when receiving. Bytes are cumulative; bitrate = the difference per interval. */
  videoSend: VideoSendStat[];
  videoRecv: VideoRecvStat[];
};

/** Chromium browsers can include tab/system audio with a screen share; all others cannot (PLAN 3.6). */
export const isChromium = () => typeof (window as { chrome?: unknown }).chrome !== "undefined";

/** Explains why a screen share is running without audio; empty when audio is included or no share is active. */
export function explainScreenAudio(state: Pick<VoiceState, "screenOn" | "screenAudio">): string {
  if (!state.screenOn || state.screenAudio !== false) return "";
  return isChromium() ? t("voice.screenNoAudioChromium") : t("voice.screenNoAudioOther");
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
  /** Output device for screen audio (separate from voice); null = default/same as voice. */
  private screenSinkId: string | null = null;
  /** Microphone mute set by the user themselves, independent of deafening. */
  private micMutedByUser = false;
  /** Last requested camera settings (for switching on again). */
  private camera: { deviceId: string | null; quality: "360p" | "720p"; blur: number } = { deviceId: null, quality: "720p", blur: 0 };
  /** Background processor (MediaPipe segmentation, running in the browser); kept around for toggling. */
  private blur: BackgroundProcessorWrapper | null = null;
  /** One AudioContext for everything (microphone gate, other participants' levels); created inside a user gesture, see prepareAudio(). */
  private audioCtx: AudioContext | null = null;
  private unlocked = false;
  /** Level meter per remote microphone track: speaker highlight without the delay of LiveKit's report (~0.5-1 s). */
  private readonly meters = new Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; gate: VoiceGate; samples: Float32Array<ArrayBuffer> }>();
  private meterTimer: number | null = null;

  constructor(audioHost?: HTMLElement) {
    this.audioHost = audioHost ?? VoiceClient.makeHost();
    // Fallback: any gesture in the document may unblock audio after the fact (resume the context, start playback).
    document.addEventListener("pointerdown", () => this.unlockOnGesture(), { capture: true, passive: true });
    document.addEventListener("keydown", () => this.unlockOnGesture(), { capture: true, passive: true });
  }

  /**
   * Call in the click handler BEFORE the first await (App.joinVoice): creates the AudioContext inside the user gesture and plays
   * silence once, so browsers with a strict autoplay policy (Safari, partly Firefox) unlock the microphone gate and playback.
   * Without this the context was only created after the token and the connection: the level stayed 0 (nobody heard you) and <audio> stayed silent.
   */
  prepareAudio(): void {
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (!this.unlocked) {
      const el = document.createElement("audio");
      el.src = SILENT_WAV;
      el.play().then(() => { this.unlocked = true; }).catch(() => { /* no gesture: try again later */ });
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

    // adaptiveStream: receive quality depending on the size of the <video> element (simulcast layer), pauses invisible tracks.
    // dynacast: the sender turns off layers nobody subscribes to. Together: PLAN M3 "simulcast layers depending on tile size".
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        videoCodec: "vp8", // decodable everywhere, no backup codec needed
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding, // 1080p, 30 fps, up to 5 Mbit/s
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
        // Also end up here when the browser itself stops the share (the "stop sharing" bar).
        if (pub.source === Track.Source.ScreenShare) this.patch({ screenOn: false, screenAudio: null });
        if (pub.source === Track.Source.Camera) this.patch({ cameraOn: false });
        this.refreshTiles();
      })
      .on(RoomEvent.TrackStreamStateChanged, () => this.refreshTiles())
      // On device changes LiveKit points all audio tracks at the voice output device; separate the screen audio again afterwards.
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
      // Microphone only after connecting, so a connection error does not also cost a permission prompt.
      const mic = new MicPipeline(settings.vadThreshold, settings.vadHangoverMs, this.ensureCtx());
      this.mic = mic;
      mic.onState = (s) => {
        const changed = s.open !== this.state.gateOpen;
        this.patch({ level: s.level, gateOpen: s.open });
        if (changed) this.refreshParticipants(); // own speaker highlight immediately, not only once LiveKit reports it
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

  // ---------- Camera and screen (M3)

  async setCameraEnabled(on: boolean, deviceId?: string | null, quality?: "360p" | "720p", blur?: number): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (deviceId !== undefined) this.camera.deviceId = deviceId;
    if (quality) this.camera.quality = quality;
    if (blur !== undefined) this.camera.blur = blur;
    try {
      const resolution = (this.camera.quality === "360p" ? VideoPresets.h360 : VideoPresets.h720).resolution;
      if (!on) this.blur = null; // the track is ended, and the processor with it
      await room.localParticipant.setCameraEnabled(on, on ? { resolution, ...(this.camera.deviceId ? { deviceId: this.camera.deviceId } : {}) } : undefined);
      this.patch({ cameraOn: on, cameraBlur: 0, error: null });
      if (on && this.camera.blur > 0) await this.setCameraBlur(this.camera.blur);
    } catch (err) {
      if (!isUserCancel(err)) this.patch({ error: t("voice.errCamera", { err: errorText(err) }) });
      this.patch({ cameraOn: room.localParticipant.isCameraEnabled });
    }
    this.refreshTiles();
    this.refreshParticipants();
  }

  /** Can this browser blur the background (WebGL2/WASM, MediaStreamTrackProcessor)? */
  static supportsBlur(): boolean { try { return supportsBackgroundProcessors(); } catch { return false; } }

  /** Set the background blur of the running camera (0 = off). The model/WASM is downloaded on first use (jsdelivr, Google Storage). */
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
      this.patch({ cameraBlur: 0, error: t("voice.errBlur", { err: errorText(err) }) });
    }
  }

  /** Opus settings from the channel profile: bitrate; mono with DTX (silence costs nothing) and RED (redundancy against loss). */
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

  /** The channel profile changed (admin): republish the microphone with the new Opus parameters. */
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
      this.patch({ error: t("voice.errProfile", { err: errorText(err) }) });
    }
  }

  async setCameraDevice(deviceId: string | null): Promise<void> {
    this.camera.deviceId = deviceId;
    if (this.state.cameraOn && this.room) await this.room.switchActiveDevice("videoinput", deviceId ?? "default").catch(() => {});
  }

  /** Share the screen; audio is always requested and published as its own track (PLAN 3.6). Whether it arrives is up to the browser. */
  async setScreenShareEnabled(on: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      // No simulcast for the screen: with small tiles adaptiveStream would fetch the coarse layer and only scale up
      // seconds after enlarging; text needs the full layer. contentHint "detail" keeps the
      // resolution and sacrifices frames per second instead when bandwidth is tight.
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
      // Cancelling in the picker dialog is not an error.
      if (!isUserCancel(err)) this.patch({ error: t("voice.errScreen", { err: errorText(err) }) });
      this.patch({ screenOn: room.localParticipant.isScreenShareEnabled });
    }
    this.refreshTiles();
    this.refreshParticipants();
  }

  /** Volume of a participant's screen audio (0..1); adjustable separately from the microphone. */
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

  /** Lift the browser's autoplay block; must be called from within a user action. */
  async startAudio(): Promise<void> {
    await this.room?.startAudio();
    this.patch({ canPlayback: this.room?.canPlaybackAudio ?? true });
  }

  /**
   * Microphone mute/unmute by hand. While deafened, a click on the microphone lifts both (as in Discord),
   * because an active microphone with the audio turned off makes no sense.
   */
  async setMuted(muted: boolean): Promise<void> {
    if (!muted && this.state.deafened) { this.micMutedByUser = false; await this.setDeafened(false); return; }
    this.micMutedByUser = muted;
    await this.applyMic();
  }

  /**
   * Deafen on/off: incoming audio muted, microphone forcibly muted. When turning the audio back on,
   * the microphone stays muted only if it had been muted by hand before.
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
    // LiveKit sets the device for all tracks; put the screen audio back on its own device afterwards.
    await this.applyScreenSink();
  }

  /** Route screen audio to a separate output device (e.g. speakers instead of a headset). Chromium only; no effect elsewhere. */
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

  /** requestCamera = true asks for camera permission once so the device names are readable (for the picker at switch-on time). */
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
    el.muted = this.state.deafened; // deafening also applies to tracks that arrive later
    this.audioHost.appendChild(el);
    if (track.source === Track.Source.ScreenShareAudio) void this.applyScreenSink();
    if (track.source === Track.Source.Microphone) this.addMeter(identity, track.mediaStreamTrack);
    this.patch({ canPlayback: this.room?.canPlaybackAudio ?? true });
  }

  // ---- Local speaker detection: RMS per remote microphone track every 50 ms, gate with hangover (like our own VAD).
  // LiveKit's ActiveSpeakersChanged arrives smoothed from the server (~0.5-1 s later) and now only serves as a fallback.
  private addMeter(identity: string, mst: MediaStreamTrack) {
    this.dropMeter(identity);
    try {
      const ctx = this.ensureCtx();
      const source = ctx.createMediaStreamSource(new MediaStream([mst]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // not to destination: playback keeps running through the <audio> element
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
      if (this.audioCtx?.state !== "running") return; // without a running context LiveKit's report applies (see refreshParticipants)
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

/** Read the active candidate path from the WebRTC statistics: protocol and candidate types (host/srflx/prflx/relay). */
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
  if (local.candidateType === "relay") return `relay (TURN via ${local.relayProtocol ?? local.protocol ?? "?"})`;
  return `${local.protocol ?? "?"} ${local.candidateType ?? "?"}->${remote?.candidateType ?? "?"}`;
}

/** Explain LiveKit's disconnect reason; unexpected = show it to the user as an error. */
function explainDisconnect(reason: DisconnectReason | undefined): { short: string; long: string; unexpected: boolean } {
  const name = reason === undefined ? t("voice.disc.unknown") : DisconnectReason[reason] ?? String(reason);
  const media = t("voice.iceHint");
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED: return { short: name, long: "", unexpected: false };
    case DisconnectReason.DUPLICATE_IDENTITY: return { short: name, long: t("voice.disc.duplicate"), unexpected: true };
    case DisconnectReason.SIGNAL_CLOSE: return { short: name, long: t("voice.disc.signalClose"), unexpected: true };
    case DisconnectReason.CONNECTION_TIMEOUT:
    case DisconnectReason.JOIN_FAILURE:
    case DisconnectReason.STATE_MISMATCH:
    case DisconnectReason.UNKNOWN_REASON:
    case undefined:
      return { short: name, long: t("voice.disc.generic", { name, media }), unexpected: true };
    default:
      return { short: name, long: t("voice.disc.server", { name }), unexpected: true };
  }
}

/** Turn a connection error into a sentence with the cause and the next step. */
function explainConnectError(message: string, url: string): string {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const pageIsHttps = window.location.protocol === "https:";
  if (host === "localhost" || host === "127.0.0.1") return t("voice.connErrLocalhost", { message, url });
  if (pageIsHttps && url.startsWith("ws://")) return t("voice.connErrWs", { message, url });
  return t("voice.connErrGeneric", { message, url, check: url.replace(/^ws/, "http") });
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** The user cancelled the browser dialog (camera/screen picker). */
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
