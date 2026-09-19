/**
 * Stereo channels capture two channels without the browser's processing (micPipeline.ts). A microphone that is really mono
 * should arrive as one channel, which Web Audio spreads to both sides by itself; an iPhone instead delivers a two-channel
 * stream with the signal on one side only, and the others heard the user in one ear (user's report, 19 September 2026).
 * This tells such an input from real stereo by the levels of the two channels, so the pipeline can put the live channel on
 * both sides. Real stereo (an interface, a stereo microphone, music) always has something on both channels and is left alone.
 *
 * Pure logic without browser APIs (tested); micPipeline.ts feeds it both channels' RMS every 50 ms.
 */
export type SideVerdict = "stereo" | "left" | "right";

/** Below this the louder channel is silence, and silence says nothing about the sides. */
const MIN_SIGNAL = 0.0005;
/** One-sided: the quiet channel stays below 1 % (-40 dB) of the loud one. Even a hard-panned source leaks more than that into a real second channel's noise. */
const DEAD_RATIO = 0.01;
/** Alive again: above 5 % (-26 dB). The gap between the two ratios keeps the verdict from flapping. */
const ALIVE_RATIO = 0.05;
/** Frames (50 ms each) of evidence before the verdict changes: half a second of signal. */
const FRAMES = 10;

export class OneSidedDetector {
  verdict: SideVerdict = "stereo";
  private evidence = 0;
  private candidate: SideVerdict = "stereo";

  /** @returns the verdict after this frame: which single channel carries the signal, or "stereo" */
  update(left: number, right: number): SideVerdict {
    const loud = Math.max(left, right);
    if (loud < MIN_SIGNAL) return this.verdict;
    const quiet = Math.min(left, right);
    const ratio = quiet / loud;
    // Between the two ratios nothing is decided: the verdict stays.
    const seen: SideVerdict | null = ratio < DEAD_RATIO ? (left > right ? "left" : "right") : ratio > ALIVE_RATIO ? "stereo" : null;
    if (seen === null || seen === this.verdict) { this.evidence = 0; return this.verdict; }
    if (seen !== this.candidate) { this.candidate = seen; this.evidence = 0; }
    if (++this.evidence >= FRAMES) { this.verdict = seen; this.evidence = 0; }
    return this.verdict;
  }
}
