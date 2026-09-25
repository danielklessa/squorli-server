import { describe, expect, it } from "vitest";
import { AutoGain, DESKTOP_BOOST_LIMITS, MIC_BOOST_MAX, MIC_BOOST_TARGET, MOBILE_BOOST_LIMITS, SOFT_CLIP_RANGE, boostLimits, normalizeMicBoost, softClip, softClipCurve } from "./micBoost";

/** `seconds` of frames (50 ms each): speech at `speech` with short pauses at `noise`, like talking. */
function talk(g: AutoGain, seconds: number, speech: number, noise: number): number {
  let gain = g.gain;
  for (let i = 0; i < seconds * 20; i++) gain = g.update(i % 10 < 7 ? speech * (0.8 + 0.4 * ((i * 7) % 10) / 10) : noise);
  return gain;
}

describe("AutoGain", () => {
  it("lifts a quiet microphone to about the target level", () => {
    const g = new AutoGain();
    const gain = talk(g, 8, 0.02, 0.001);
    expect(gain * 0.02).toBeGreaterThan(MIC_BOOST_TARGET * 0.6);
    expect(gain * 0.02).toBeLessThan(MIC_BOOST_TARGET * 1.3);
  });
  it("leaves a well set microphone alone and never attenuates a loud one", () => {
    expect(talk(new AutoGain(), 8, 0.1, 0.002)).toBeLessThan(1.3);
    expect(talk(new AutoGain(), 8, 0.4, 0.002)).toBe(1);
  });
  it("stops at the maximum for a very quiet microphone", () => {
    expect(talk(new AutoGain(), 20, 0.004, 0.0003)).toBeLessThanOrEqual(MIC_BOOST_MAX);
    expect(talk(new AutoGain(), 20, 0.004, 0.0003)).toBeGreaterThan(MIC_BOOST_MAX * 0.9);
  });
  it("a phone's very quiet capture: a computer's limits never start, the phone's reach the voice activation threshold", () => {
    // The reported iPhone case as assumed (not measured): speech far below the 0.003 a computer takes for the quietest speech.
    const speech = 0.002;
    expect(talk(new AutoGain(), 20, speech, 0.0001)).toBe(1);
    const gain = talk(new AutoGain(1, MOBILE_BOOST_LIMITS), 20, speech, 0.0001);
    expect(gain).toBeLessThanOrEqual(MOBILE_BOOST_LIMITS.max);
    expect(gain * speech).toBeGreaterThan(0.04); // DEFAULT_VOICE_SETTINGS.vadThreshold
  });
  it("a phone does not learn from steady noise either", () => {
    const g = new AutoGain(1, MOBILE_BOOST_LIMITS);
    for (let i = 0; i < 600; i++) g.update(0.002);
    expect(g.gain).toBe(1);
  });
  it("picks the limits by device", () => {
    expect(boostLimits(false)).toBe(DESKTOP_BOOST_LIMITS);
    expect(boostLimits(true)).toBe(MOBILE_BOOST_LIMITS);
    expect(DESKTOP_BOOST_LIMITS.max).toBe(MIC_BOOST_MAX);
  });
  it("does not learn from silence or steady noise", () => {
    const g = new AutoGain();
    for (let i = 0; i < 600; i++) g.update(0.004);
    expect(g.gain).toBe(1);
    const learned = new AutoGain(3);
    for (let i = 0; i < 600; i++) learned.update(0.0005);
    expect(learned.gain).toBe(3);
  });
  it("needs half a second of speech before it moves (a cough is no speech level)", () => {
    const g = new AutoGain();
    for (let i = 0; i < 5; i++) g.update(0.01);
    expect(g.gain).toBe(1);
  });
  it("comes down quickly when the microphone turns out louder than remembered", () => {
    const g = new AutoGain(MIC_BOOST_MAX);
    expect(talk(g, 3, 0.1, 0.002)).toBeLessThan(1.5);
  });
  it("starts from the remembered gain, clamped", () => {
    expect(new AutoGain(2.5).gain).toBe(2.5);
    expect(new AutoGain(99).gain).toBe(MIC_BOOST_MAX);
    expect(new AutoGain(Number.NaN).gain).toBe(1);
  });
});

describe("softClip", () => {
  it("passes everything below the knee unchanged and never exceeds 1", () => {
    for (const x of [0, 0.1, -0.5, 0.8, -0.8]) expect(softClip(x)).toBe(x);
    for (const x of [0.9, 1, 2, 4, 50]) { expect(softClip(x)).toBeGreaterThan(0.8); expect(softClip(x)).toBeLessThanOrEqual(1); expect(softClip(-x)).toBe(-softClip(x)); }
    expect(softClip(0.9)).toBeLessThan(0.9);
  });
  it("builds the node's curve over the scaled range", () => {
    const c = softClipCurve(4097);
    expect(c[2048]).toBe(0);
    expect(c[0]).toBeCloseTo(-1, 5);
    expect(c[4096]).toBeCloseTo(1, 5);
    // Input 0.5 / RANGE sits at this index and must come out as 0.5.
    expect(c[2048 + Math.round((0.5 / SOFT_CLIP_RANGE) * 2048)]).toBeCloseTo(0.5, 6);
  });
});

describe("normalizeMicBoost", () => {
  it("defaults to off and repairs rubbish", () => {
    expect(normalizeMicBoost(undefined)).toEqual({ auto: false, gain: 1 });
    expect(normalizeMicBoost({ auto: false, gain: 3 })).toEqual({ auto: false, gain: 3 });
    // Stored settings keep what a phone may set; the pipeline clamps to the limits of the device it runs on.
    expect(normalizeMicBoost({ auto: "yes", gain: 400 })).toEqual({ auto: false, gain: MOBILE_BOOST_LIMITS.max });
  });
});
