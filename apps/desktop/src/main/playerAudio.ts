import { webContents, type WebFrameMain } from "electron";
import { playerAudioScript, playerKindOf, type PlayerAudioResult, type PlayerKind } from "./playerAudioScript";

const EVERY_MS = 3000;

/**
 * Puts the embedded players' sound on the output device the user chose: the web radio's players on the radio's device,
 * the players of videos linked in the chat on the device of screen share audio (`playerKindOf`, playerAudioScript.ts). The
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
  private readonly labels: Record<PlayerKind, string | null> = { radio: null, chat: null };
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = 0;
  private busy = false;

  constructor(private readonly log: (text: string) => void = () => {}) {}

  private get chosen(): boolean { return this.labels.radio !== null || this.labels.chat !== null; }

  granting(): boolean { return this.chosen || this.running > 0; }

  setLabel(kind: PlayerKind, label: string | null): void {
    if (label === this.labels[kind]) return;
    this.labels[kind] = label;
    if (this.chosen) this.timer ??= setInterval(() => { void this.pass(); }, EVERY_MS);
    else if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    void this.pass(); // also for null: players already moved go back to the default device
  }

  stop(): void { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } }

  private playerFrames(): { frame: WebFrameMain; kind: PlayerKind }[] {
    const frames: { frame: WebFrameMain; kind: PlayerKind }[] = [];
    for (const contents of webContents.getAllWebContents()) {
      if (contents.isDestroyed()) continue;
      try { for (const frame of contents.mainFrame.framesInSubtree) { const kind = playerKindOf(frame.url); if (kind) frames.push({ frame, kind }); } } catch { /* a window on its way out */ }
    }
    return frames;
  }

  private async pass(): Promise<void> {
    if (this.busy) return;
    const frames = this.playerFrames();
    if (frames.length === 0) return;
    this.busy = true;
    this.running++;
    try {
      for (const { frame, kind } of frames) {
        try {
          const result = await frame.executeJavaScript(playerAudioScript(this.labels[kind]), true) as PlayerAudioResult;
          if (result.moved > 0 || result.error) this.log(`player audio (${kind}): ${new URL(frame.url).host} elements=${result.elements} moved=${result.moved}${result.error ? ` error=${result.error}` : ""}`);
        } catch { /* the frame navigated or went away */ }
      }
    } finally { this.running--; this.busy = false; }
  }
}
