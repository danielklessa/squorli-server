import { AFK_AFTER_MS } from "@squorli/protocol";
import type { ActivityTracker } from "./activity";

/**
 * System-wide part of the AFK detection: the Idle Detection API (Chromium only) tells whether the user gives input anywhere
 * in the system and whether the screen is locked. The browser asks the user for the permission, and only inside a click,
 * so it is a switch in the settings (Ansicht) and stored per device (`chat.idleDetection.v1`): the permission belongs to
 * this browser, not to the account. Without it (Firefox, Safari, switch off, permission denied) the tracker works from
 * input in the Squorli window and speaking alone. The desktop app needs no switch: its shell grants the permission by
 * itself (`platform.systemIdle === "always"`, checked in the shell on 18 September 2026), so detection simply runs there.
 */
const KEY = "chat.idleDetection.v1";

type IdleDetectorLike = EventTarget & { userState: "active" | "idle" | null; screenState: "locked" | "unlocked" | null; start(options: { threshold: number; signal: AbortSignal }): Promise<void> };
type IdleDetectorCtor = { new(): IdleDetectorLike; requestPermission(): Promise<"granted" | "denied"> };
const ctor = (): IdleDetectorCtor | null => (typeof window !== "undefined" ? (window as { IdleDetector?: IdleDetectorCtor }).IdleDetector ?? null : null);

export const idleDetectionSupported = (): boolean => ctor() !== null;
export function idleDetectionWanted(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

let running: AbortController | null = null;

async function start(tracker: ActivityTracker): Promise<boolean> {
  const Detector = ctor();
  if (!Detector) return false;
  running?.abort();
  const controller = new AbortController();
  try {
    const detector = new Detector();
    const report = () => tracker.setSystemIdle(detector.userState === "idle" || detector.screenState === "locked");
    detector.addEventListener("change", report);
    await detector.start({ threshold: AFK_AFTER_MS, signal: controller.signal });
    running = controller;
    report();
    return true;
  } catch {
    // Not permitted (any more) or blocked by a permissions policy: fall back to the window's own input.
    tracker.setSystemIdle(null);
    return false;
  }
}

/**
 * At page load: resume when the user switched it on earlier and the permission still stands (no prompt possible here).
 * `always` (desktop app): there is no switch, it runs whenever it can.
 */
export async function resumeIdleDetection(tracker: ActivityTracker, always = false): Promise<void> {
  if (!idleDetectionSupported()) return;
  if (always) { await start(tracker); return; }
  if (!idleDetectionWanted()) return;
  const state = await navigator.permissions.query({ name: "idle-detection" as PermissionName }).then((p) => p.state, () => "denied");
  if (state === "granted") await start(tracker);
}

/** The switch in the settings; call inside the click. Returns whether detection is running afterwards (false after "on" = permission denied). */
export async function setIdleDetection(tracker: ActivityTracker, on: boolean): Promise<boolean> {
  const Detector = ctor();
  if (!on || !Detector) {
    running?.abort(); running = null;
    tracker.setSystemIdle(null);
    try { localStorage.removeItem(KEY); } catch { /* private mode */ }
    return false;
  }
  const granted = await Detector.requestPermission().then((p) => p === "granted", () => false);
  const ok = granted && await start(tracker);
  try { if (ok) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  return ok;
}
