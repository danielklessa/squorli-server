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

/**
 * Does an AudioContext in this state have to be resumed before it processes anything? Everything but "running" and "closed":
 * besides "suspended" there is WebKit's "interrupted" (iOS sets it when the microphone prompt shows, when the capture
 * starts and on a phone call). The client only ever resumed "suspended", so on an iPhone that was asked for the
 * microphone the pipeline ran through a standing context: level 0, nobody heard the user (user's report, 19 September 2026).
 */
export const contextNeedsResume = (state: string): boolean => state !== "running" && state !== "closed";

/** RMS level 0..1 from time-domain samples (Float32, -1..1). */
export function rmsLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (samples.length || 1));
}
