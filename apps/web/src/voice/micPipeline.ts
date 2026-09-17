import { VoiceGate, rmsLevel } from "./gate";

/**
 * Microphone pipeline: getUserMedia -> AudioContext -> [analyser for the level] + [gain as the gate] -> output track.
 *
 * The gate (voice activation or push-to-talk) works locally through the gain; the published track stays
 * published and "unmuted" throughout. That way there is no signalling on every word and
 * switching back on is instant (PLAN 3.5). The mute button is separate from this (LiveKit mute).
 */
export type GateMode = "vad" | "ptt";

/** The chosen device does not exist (any more): unplugged, or the browser handed out new device ids. */
const isDeviceGone = (err: unknown) => {
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  return name === "OverconstrainedError" || name === "NotFoundError";
};

/**
 * Opens the microphone. The stored device is requested with `exact` so the browser does not quietly pick another one
 * while it exists; when it is gone, the default microphone takes over (`fellBack`) instead of the join failing
 * with "Constraints could not be satisfied". The stored choice stays, so the device is used again once it is back.
 */
export async function openMic(
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>, deviceId: string | null, stereo: boolean,
): Promise<{ stream: MediaStream; fellBack: boolean }> {
  const audio = (id: string | null): MediaTrackConstraints => ({
    ...(id ? { deviceId: { exact: id } } : {}),
    // Use the browser's own processing (PLAN 7: "browser-native echo/noise suppression").
    // Stereo (music channels): processing off, because echo/noise suppression downmixes to mono.
    echoCancellation: !stereo,
    noiseSuppression: !stereo,
    autoGainControl: !stereo,
    channelCount: stereo ? 2 : 1,
  });
  try {
    return { stream: await getUserMedia({ audio: audio(deviceId) }), fellBack: false };
  } catch (err) {
    if (!deviceId || !isDeviceGone(err)) throw err;
    return { stream: await getUserMedia({ audio: audio(null) }), fellBack: true };
  }
}

export class MicPipeline {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private samples = new Float32Array(1024);
  private timer: number | null = null;
  private gate: VoiceGate;
  private mode: GateMode = "vad";
  private pttHeld = false;
  private forcedOpen = false;
  /** Current level (0..1) and whether the gate is open; for the display. */
  readonly state = { level: 0, open: false };
  onState: ((s: { level: number; open: boolean }) => void) | null = null;
  /** The last start() used the default microphone because the chosen device was gone. */
  deviceFallback = false;

  private ownsCtx: boolean;

  /** @param ctx shared AudioContext (created by the VoiceClient inside a user gesture); without it the pipeline creates its own. */
  constructor(threshold: number, hangoverMs: number, ctx?: AudioContext) {
    this.gate = new VoiceGate(threshold, hangoverMs);
    this.ctx = ctx ?? null;
    this.ownsCtx = !ctx;
  }

  /** State of the AudioContext ("running" is required, otherwise the microphone stays silent). */
  contextState(): string { return this.ctx?.state ?? "none"; }

  /** Starts the capture. Returns the track that is published to LiveKit. */
  async start(deviceId: string | null, stereo = false): Promise<MediaStreamTrack> {
    await this.stopCapture();
    const opened = await openMic((c) => navigator.mediaDevices.getUserMedia(c), deviceId, stereo);
    this.stream = opened.stream;
    this.deviceFallback = opened.fellBack;
    if (!this.ctx || this.ctx.state === "closed") { this.ctx = new AudioContext(); this.ownsCtx = true; }
    // resume() hangs forever in some browsers without a user gesture; do not wait for it, the click fallback in the
    // VoiceClient catches up on it. Until then the pipeline delivers silence (level 0).
    if (this.ctx.state === "suspended") await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.dest = this.ctx.createMediaStreamDestination();
    this.dest.channelCount = stereo ? 2 : 1;
    this.dest.channelCountMode = "explicit";
    this.source.connect(this.analyser);
    this.source.connect(this.gain);
    this.gain.connect(this.dest);

    this.gate.reset();
    this.timer = window.setInterval(() => this.tick(), 50);
    const track = this.dest.stream.getAudioTracks()[0];
    if (!track) throw new Error("kein Ausgangs-Track");
    return track;
  }

  /** Current capture device (deviceId), as the browser actually picked it. */
  activeDeviceId(): string | null {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null;
  }

  setMode(mode: GateMode) { this.mode = mode; this.gate.reset(); this.pttHeld = false; this.apply(); }
  setThreshold(t: number) { this.gate.threshold = t; }
  setHangover(ms: number) { this.gate.hangoverMs = ms; }
  setPttHeld(held: boolean) { this.pttHeld = held; this.apply(); }
  /** Keep the gate permanently open (e.g. a microphone test). */
  setForcedOpen(v: boolean) { this.forcedOpen = v; this.apply(); }

  private tick() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    this.state.level = rmsLevel(this.samples);
    if (this.mode === "vad") this.gate.update(this.state.level, performance.now());
    this.apply();
  }

  private apply() {
    const open = this.forcedOpen || (this.mode === "ptt" ? this.pttHeld : this.gate.isOpen());
    if (this.gain) {
      // Short ramp instead of a hard cut: avoids clicks.
      const t = this.ctx!.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setTargetAtTime(open ? 1 : 0, t, 0.01);
    }
    if (open !== this.state.open) this.state.open = open;
    this.onState?.({ level: this.state.level, open });
  }

  private async stopCapture() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.source?.disconnect(); this.analyser?.disconnect(); this.gain?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source = this.analyser = this.gain = this.dest = null;
    this.stream = null;
    this.state.level = 0; this.state.open = false;
  }

  async stop() {
    await this.stopCapture();
    if (this.ownsCtx) await this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
