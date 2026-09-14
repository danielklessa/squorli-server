import { VoiceGate, rmsLevel } from "./gate";

/**
 * Mikrofon-Pipeline: getUserMedia -> AudioContext -> [Analyser fuer Pegel] + [Gain als Tor] -> Ausgangs-Track.
 *
 * Das Tor (Sprachaktivierung oder Push-to-Talk) arbeitet lokal ueber den Gain, der publizierte Track bleibt
 * durchgehend veroeffentlicht und "unmuted". So gibt es keine Signalisierung bei jedem Wort und das
 * Wieder-Einschalten ist verzoegerungsfrei (PLAN 3.5). Der Stumm-Knopf ist davon getrennt (LiveKit mute).
 */
export type GateMode = "vad" | "ptt";

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
  /** Aktueller Pegel (0..1) und ob das Tor offen ist; fuer die Anzeige. */
  readonly state = { level: 0, open: false };
  onState: ((s: { level: number; open: boolean }) => void) | null = null;

  private ownsCtx: boolean;

  /** @param ctx geteilter AudioContext (vom VoiceClient in einer Nutzergeste angelegt); ohne ihn legt die Pipeline einen eigenen an. */
  constructor(threshold: number, hangoverMs: number, ctx?: AudioContext) {
    this.gate = new VoiceGate(threshold, hangoverMs);
    this.ctx = ctx ?? null;
    this.ownsCtx = !ctx;
  }

  /** Zustand des AudioContext ("running" noetig, sonst bleibt das Mikrofon stumm). */
  contextState(): string { return this.ctx?.state ?? "none"; }

  /** Startet die Aufnahme. Liefert den Track, der bei LiveKit publiziert wird. */
  async start(deviceId: string | null, stereo = false): Promise<MediaStreamTrack> {
    await this.stopCapture();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        // Browser-eigene Verarbeitung nutzen (PLAN 7: "Browser-eigene Echo-/Rauschunterdrueckung").
        // Stereo (Musik-Kanaele): Verarbeitung aus, denn Echo-/Rauschunterdrueckung mischt auf Mono herunter.
        echoCancellation: !stereo,
        noiseSuppression: !stereo,
        autoGainControl: !stereo,
        channelCount: stereo ? 2 : 1,
      },
    });
    if (!this.ctx || this.ctx.state === "closed") { this.ctx = new AudioContext(); this.ownsCtx = true; }
    // resume() haengt in manchen Browsern ohne Nutzergeste ewig; nicht darauf warten, der Klick-Fallback im
    // VoiceClient holt es nach. Bis dahin liefert die Pipeline Stille (Pegel 0).
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

  /** Aktuelles Aufnahmegeraet (deviceId), wie es der Browser tatsaechlich gewaehlt hat. */
  activeDeviceId(): string | null {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null;
  }

  setMode(mode: GateMode) { this.mode = mode; this.gate.reset(); this.pttHeld = false; this.apply(); }
  setThreshold(t: number) { this.gate.threshold = t; }
  setHangover(ms: number) { this.gate.hangoverMs = ms; }
  setPttHeld(held: boolean) { this.pttHeld = held; this.apply(); }
  /** Tor dauerhaft offen (z. B. Mikrofon-Test). */
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
      // Kurze Rampe statt hartem Schnitt: vermeidet Klicken.
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
