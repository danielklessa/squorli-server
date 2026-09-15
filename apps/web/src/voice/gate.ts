/**
 * Voice activation gate: pure logic without browser APIs, so it stays testable.
 *
 * Open as soon as the level exceeds the threshold; closes only once the level
 * has stayed below the threshold for the hangover time.
 */
export class VoiceGate {
  private open = false;
  private lastAbove = -Infinity;

  constructor(public threshold: number, public hangoverMs: number) {}

  /** @param level RMS 0..1  @param now timestamp in ms  @returns whether the gate is open now */
  update(level: number, now: number): boolean {
    if (level >= this.threshold) {
      this.lastAbove = now;
      this.open = true;
    } else if (this.open && now - this.lastAbove >= this.hangoverMs) {
      this.open = false;
    }
    return this.open;
  }

  isOpen(): boolean {
    return this.open;
  }

  reset(): void {
    this.open = false;
    this.lastAbove = -Infinity;
  }
}

/** RMS level 0..1 from time-domain samples (Float32, -1..1). */
export function rmsLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (samples.length || 1));
}
