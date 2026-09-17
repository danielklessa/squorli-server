import { AFK_AFTER_MS } from "@squorli/protocol";

/**
 * AFK detection (17 September 2026, user's requirement): after AFK_AFTER_MS without activity the user counts as absent.
 * The client measures it, because only it sees input; the store reports every change to the chat servers and to the
 * directory (`activity` events), which turn the reports of all of a user's connections into the state others see.
 *
 * What counts as activity (user's decisions):
 * - input in a Squorli window: pointer, keys, wheel, touch (`watchActivity`), which includes the push-to-talk key;
 * - speaking: the open speech gate of an unmuted microphone (App.tsx feeds `touch()` from the voice client), so somebody
 *   who plays a game and talks is not moved away;
 * - with the Idle Detection API (Chromium, needs the user's permission, idleDetection.ts): input anywhere in the system.
 *   While the detector reports the user active they are never idle; once it reports idle (or the screen is locked) the
 *   rule above decides. Without a detector (`systemIdle` null) only the first two count.
 */
export class ActivityTracker {
  private last: number;
  private systemIdle: boolean | null = null;
  private idleNow = false;
  private readonly listeners = new Set<(idle: boolean) => void>();

  constructor(private readonly idleMs: number = AFK_AFTER_MS, private readonly now: () => number = () => Date.now()) {
    this.last = this.now();
  }

  get idle(): boolean { return this.idleNow; }

  subscribe(fn: (idle: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Input or speech just happened. */
  touch(): void {
    this.last = this.now();
    this.check();
  }

  /** The system-wide detector's verdict: true = no input anywhere (or screen locked), false = in use, null = no detector. */
  setSystemIdle(idle: boolean | null): void {
    this.systemIdle = idle;
    this.check();
  }

  /** Re-evaluate; call regularly, because turning idle happens without any event. */
  check(): void {
    const idle = (this.systemIdle ?? true) && this.now() - this.last >= this.idleMs;
    if (idle === this.idleNow) return;
    this.idleNow = idle;
    for (const fn of this.listeners) fn(idle);
  }
}

/** The one tracker of this page: the store reports it, App.tsx and the video pop-outs feed it. */
export const activity = new ActivityTracker();

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const CHECK_MS = 5_000;

/** Feed a tracker from the input events of a window (the main page, a video pop-out) and keep it checking. Returns the cleanup. */
export function watchActivity(tracker: ActivityTracker, win: Window = window): () => void {
  let lastTouch = 0;
  const onInput = () => {
    // Pointer moves arrive by the hundred; once a second is plenty for a five-minute rule.
    const t = Date.now();
    if (t - lastTouch < 1000 && !tracker.idle) return;
    lastTouch = t;
    tracker.touch();
  };
  for (const name of INPUT_EVENTS) win.addEventListener(name, onInput, { capture: true, passive: true });
  const timer = win.setInterval(() => tracker.check(), CHECK_MS);
  return () => {
    for (const name of INPUT_EVENTS) win.removeEventListener(name, onInput, { capture: true });
    win.clearInterval(timer);
  };
}
