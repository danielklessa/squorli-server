import { webContents, type WebFrameMain } from "electron";
import { isPlayerFrameUrl, playerAudioScript, type PlayerAudioResult } from "./playerAudioScript";

const EVERY_MS = 3000;

/**
 * Puts the embedded players' sound on the output device the user chose for the web radio (playerAudioScript.ts). The
 * players make new media elements as they go (the next video, ads), so while a device is chosen every player frame is
 * looked at every few seconds; a pass that finds nothing to move does nothing.
 *
 * A frame only learns device labels and may only use another device than the default while its origin passes the
 * microphone permission CHECK (security.ts answers it; a REQUEST, getUserMedia, stays refused). `granting()` says when:
 * while our script runs, and **for as long as a device is chosen**. The second part is not optional: Chromium asks again
 * every time a media element starts a new video, and a "no" then leaves the element on its device id but silent (user's
 * report, 20 September 2026: no sound after a playlist moved on; reproduced with `isCurrentlyAudible()`). The price: while
 * the user routes the players to a device of their choice, the players' own scripts could read the names of the audio
 * devices. Without a chosen device nothing is granted beyond our own call.
 */
export class PlayerAudioOutput {
  private label: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = 0;
  private busy = false;

  constructor(private readonly log: (text: string) => void = () => {}) {}

  granting(): boolean { return this.label !== null || this.running > 0; }

  setLabel(label: string | null): void {
    if (label === this.label) return;
    this.label = label;
    if (label !== null) this.timer ??= setInterval(() => { void this.pass(); }, EVERY_MS);
    else if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    void this.pass(); // also for null: players already moved go back to the default device
  }

  stop(): void { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } }

  private playerFrames(): WebFrameMain[] {
    const frames: WebFrameMain[] = [];
    for (const contents of webContents.getAllWebContents()) {
      if (contents.isDestroyed()) continue;
      try { for (const frame of contents.mainFrame.framesInSubtree) if (isPlayerFrameUrl(frame.url)) frames.push(frame); } catch { /* a window on its way out */ }
    }
    return frames;
  }

  private async pass(): Promise<void> {
    if (this.busy) return;
    const frames = this.playerFrames();
    if (frames.length === 0) return;
    this.busy = true;
    const script = playerAudioScript(this.label);
    this.running++;
    try {
      for (const frame of frames) {
        try {
          const result = await frame.executeJavaScript(script, true) as PlayerAudioResult;
          if (result.moved > 0 || result.error) this.log(`player audio: ${new URL(frame.url).host} elements=${result.elements} moved=${result.moved}${result.error ? ` error=${result.error}` : ""}`);
        } catch { /* the frame navigated or went away */ }
      }
    } finally { this.running--; this.busy = false; }
  }
}
