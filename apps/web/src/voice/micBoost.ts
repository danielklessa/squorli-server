/**
 * Microphone boost: raises quiet microphones before the gate, the level meter and the published track.
 *
 * Why (user's report, 18 September 2026: "der Mikrofonpegel ist bei vielen Leuten extrem niedrig"): the client relied on the
 * browser's automatic gain control alone and had no gain of its own, and STEREO channels capture without the browser's
 * processing, so without that control: there a microphone arrived at its raw level (the reported case: level bar low,
 * threshold at the far left, everyone quiet, app and Firefox alike). In mono channels Chromium's control brings even a
 * very quiet input (RMS 0.003) to about 0.085, so there the automatic here ends near x1 and changes nothing.
 * Measurements: docs/features/voice-video.md.
 *
 * Pure logic without browser APIs (tested); micPipeline.ts feeds it the input level every 50 ms and sets the gain.
 */

/** Largest boost on a computer, automatic or by hand (x12 = +21.6 dB). A stereo channel captures without the browser's gain control; a raw microphone set low in the system needs that much. */
export const MIC_BOOST_MAX = 12;

/**
 * How far the boost may go and from which raw level on the automatic takes something for speech.
 *
 * A phone needs its own (user's report, 19 September 2026: "auf meinem iPhone erreiche ich den Pegel nie"): iOS hands the
 * page its voice-processed capture far below what a computer delivers, and with the limits of a computer the automatic never
 * even started, because speech stayed under the 0.003 it takes for the quietest possible speech; and had it started, x12
 * would not have reached the threshold. The phone's own noise suppression leaves near silence between words, so the lower
 * speech level is safe there (the floor rule, four times the quietest level seen, still applies). NOT measured on a device;
 * the debug view shows the raw level ("Eingang") to check it.
 */
export type MicBoostLimits = { max: number; minSpeech: number };
export const DESKTOP_BOOST_LIMITS: MicBoostLimits = { max: MIC_BOOST_MAX, minSpeech: 0.003 };
/** x40 = +32 dB. */
export const MOBILE_BOOST_LIMITS: MicBoostLimits = { max: 40, minSpeech: 0.0006 };
export const boostLimits = (mobile: boolean): MicBoostLimits => (mobile ? MOBILE_BOOST_LIMITS : DESKTOP_BOOST_LIMITS);
/** Speech level the automatic aims for (RMS 0..1; about -20 dBFS, where a well set microphone with the browser's processing sits). */
export const MIC_BOOST_TARGET = 0.1;

export type MicBoostSettings = {
  /** true = learn the gain from the speech level; false = `gain` as set by hand. */
  auto: boolean;
  /** Gain by hand, 1..MIC_BOOST_MAX (1 = off). */
  gain: number;
};
export const DEFAULT_MIC_BOOST: MicBoostSettings = { auto: true, gain: 1 };

export const clampBoost = (g: unknown, max = MIC_BOOST_MAX): number => (typeof g === "number" && Number.isFinite(g) ? Math.min(max, Math.max(1, g)) : 1);
/** Stored settings: clamped to the widest limits there are; the pipeline clamps to those of the device it runs on. */
export function normalizeMicBoost(raw: unknown): MicBoostSettings {
  const r = (raw ?? {}) as Partial<MicBoostSettings>;
  return { auto: typeof r.auto === "boolean" ? r.auto : DEFAULT_MIC_BOOST.auto, gain: clampBoost(r.gain, MOBILE_BOOST_LIMITS.max) };
}

/**
 * Learns the gain from the speech level of the raw input. It only ever boosts (loud microphones are the browser's job) and
 * only learns while someone speaks, so pauses do not pump the noise up. Speech is told from noise by a floor that follows
 * the quietest level seen: independent of the voice activation gate, which sits behind the boost and would never open for
 * the very microphones this is for.
 */
export class AutoGain {
  private floor = 0.002;
  private speech = 0;
  private speechFrames = 0;
  gain: number;

  constructor(initialGain = 1, private readonly limits: MicBoostLimits = DESKTOP_BOOST_LIMITS) { this.gain = clampBoost(initialGain, limits.max); }

  /** @param level RMS 0..1 of the raw input over the last frame (50 ms)  @returns the gain to apply now */
  update(level: number): number {
    // Floor: drops quickly to a quieter level, creeps up slowly (a fan that starts, a window that opens).
    this.floor = level < this.floor ? this.floor + (level - this.floor) * 0.3 : this.floor + (level - this.floor) * 0.002;
    const speaking = level > Math.max(this.floor * 4, this.limits.minSpeech);
    if (!speaking) return this.gain;
    // Speech level: follows louder passages quickly and quieter ones slowly, so it sits near the loud syllables.
    this.speech = this.speechFrames === 0 ? level : this.speech + (level - this.speech) * (level > this.speech ? 0.2 : 0.02);
    this.speechFrames++;
    if (this.speechFrames < 10) return this.gain; // half a second of speech before the first judgement (a cough is no speech level)
    const wanted = clampBoost(MIC_BOOST_TARGET / Math.max(this.speech, 1e-4), this.limits.max);
    // Towards the wanted gain in about a second of speech; down faster than up (too loud is worse than too quiet).
    this.gain += (wanted - this.gain) * (wanted < this.gain ? 0.15 : 0.05);
    return this.gain;
  }
}

/**
 * A WaveShaperNode reads its curve for inputs -1..1 and clamps what lies outside, but a boosted signal can exceed 1. So the
 * node gets the signal divided by this range (the boost's GainNode is set to gain / SOFT_CLIP_RANGE) and the curve answers
 * with real amplitudes.
 */
export const SOFT_CLIP_RANGE = 4;

/** The clipping guard as a function of the real amplitude: identity up to `knee`, then a smooth bend that approaches 1 and never passes it. */
export function softClip(x: number, knee = 0.8): number {
  const a = Math.abs(x);
  const span = 1 - knee;
  return a <= knee ? x : Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
}

/**
 * Curve for the WaveShaperNode behind the boost (input = amplitude / SOFT_CLIP_RANGE). A boosted shout is rounded off instead
 * of clipping hard; everything below the knee passes unchanged (unlike a DynamicsCompressorNode, which adds make-up gain to
 * every signal). 4097 points: the identity part is exact under the node's linear interpolation, the bend is smooth enough.
 */
export function softClipCurve(samples = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) curve[i] = softClip(((i / (samples - 1)) * 2 - 1) * SOFT_CLIP_RANGE);
  return curve;
}
