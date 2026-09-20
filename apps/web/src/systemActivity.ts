import type { ActivityTracker } from "./activity";
import type { Platform } from "./platform/types";

/**
 * What only the desktop app's shell can see, as part of the AFK detection (user's decisions, 20 September 2026,
 * docs/features/afk.md): somebody who plays with a controller and only listens gives no keyboard or mouse input, and the
 * system's idle detection does not count controllers. The browser's Gamepad API was tried first and delivers only while the
 * window has the focus (the user's test), so the shell's native helper reports controller input instead; every report
 * counts as activity. The helper also reports whether some program keeps the display on, which browsers and players do while
 * a video plays, windowed too, and a voice connection alone does not (the user's measurements, 21 September 2026): that
 * keeps the user present for at most four hours without input (`ActivityTracker.setVideoPlaying`). The state does not say
 * which program holds it, and Squorli holds it itself while it shows video (cameras, screen shares, the radio's player):
 * during that time it is ignored (`setOwnVideo`) and the rules without it apply.
 */
export type SystemActivityDiagnostics = { available: boolean; inputs: number; lastInput: number | null; display: boolean | null; ownVideo: boolean };
const diagnostics: SystemActivityDiagnostics = { available: false, inputs: 0, lastInput: null, display: null, ownVideo: false };
const applyVideo = (tracker: ActivityTracker) => tracker.setVideoPlaying(diagnostics.display === true && !diagnostics.ownVideo);

/** Squorli shows video itself right now (App.tsx): the display state then says nothing about other programs. */
export function setOwnVideo(tracker: ActivityTracker, on: boolean): void {
  diagnostics.ownVideo = on;
  applyVideo(tracker);
}
export const systemActivityDiagnostics = (): SystemActivityDiagnostics => ({ ...diagnostics });

/** Feed a tracker from the platform's system activity (null = a browser, an older app, no helper). Returns the cleanup. */
export function watchSystemActivity(tracker: ActivityTracker, source: Platform["systemActivity"]): () => void {
  diagnostics.available = source !== null;
  if (!source) return () => {};
  return source.subscribe((event) => {
    if (event.type === "display") { diagnostics.display = event.required; applyVideo(tracker); return; }
    diagnostics.inputs++;
    diagnostics.lastInput = Date.now();
    tracker.touch();
  });
}
