/**
 * Sprachaktivierungs-Gate: reine Logik ohne Browser-APIs, damit sie testbar ist.
 *
 * Offen, sobald der Pegel die Schwelle ueberschreitet; schliesst erst, wenn der Pegel
 * fuer die Nachlaufzeit (hangover) unter der Schwelle geblieben ist.
 */
export class VoiceGate {
  private open = false;
  private lastAbove = -Infinity;

  constructor(public threshold: number, public hangoverMs: number) {}

  /** @param level RMS 0..1  @param now Zeitstempel in ms  @returns ob das Gate jetzt offen ist */
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

/** RMS-Pegel 0..1 aus Zeitbereichs-Samples (Float32, -1..1). */
export function rmsLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (samples.length || 1));
}
