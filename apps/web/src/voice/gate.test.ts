import { describe, expect, it } from "vitest";
import { VoiceGate, rmsLevel } from "./gate";

describe("VoiceGate", () => {
  it("opens above threshold and holds for the hangover", () => {
    const g = new VoiceGate(0.1, 300);
    expect(g.update(0.05, 0)).toBe(false);
    expect(g.update(0.2, 100)).toBe(true);
    expect(g.update(0.01, 200)).toBe(true); // innerhalb der Nachlaufzeit
    expect(g.update(0.01, 399)).toBe(true);
    expect(g.update(0.01, 400)).toBe(false); // 300 ms nach dem letzten Pegel ueber der Schwelle
  });

  it("extends the hangover while speech continues", () => {
    const g = new VoiceGate(0.1, 300);
    g.update(0.2, 0);
    g.update(0.2, 250);
    expect(g.update(0.0, 500)).toBe(true);
    expect(g.update(0.0, 551)).toBe(false);
  });

  it("resets", () => {
    const g = new VoiceGate(0.1, 300);
    g.update(0.5, 0);
    g.reset();
    expect(g.isOpen()).toBe(false);
    expect(g.update(0.0, 1)).toBe(false);
  });
});

describe("rmsLevel", () => {
  it("is 0 for silence and ~0.707 for a full-scale square wave", () => {
    expect(rmsLevel(new Float32Array(16))).toBe(0);
    const sq = new Float32Array(16).map((_, i) => (i % 2 ? 1 : -1));
    expect(rmsLevel(sq)).toBeCloseTo(1, 5);
    const half = new Float32Array(16).fill(0.5);
    expect(rmsLevel(half)).toBeCloseTo(0.5, 5);
  });
});
