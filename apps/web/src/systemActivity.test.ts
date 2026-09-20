import { describe, expect, it } from "vitest";
import { ActivityTracker } from "./activity";
import type { SystemActivityEvent } from "./platform/bridge";
import { setOwnVideo, systemActivityDiagnostics, watchSystemActivity } from "./systemActivity";

const MIN = 60_000;

describe("watchSystemActivity", () => {
  it("counts controller input as activity", () => {
    let now = 0;
    const tracker = new ActivityTracker(10 * MIN, () => now);
    let emit: (event: SystemActivityEvent) => void = () => {};
    let unsubscribed = false;
    const stop = watchSystemActivity(tracker, { subscribe: (cb) => { emit = cb; return () => { unsubscribed = true; }; } });

    now = 9 * MIN; emit({ type: "input" });
    now = 15 * MIN; tracker.check();
    expect(tracker.idle).toBe(false);
    now = 19 * MIN; tracker.check();
    expect(tracker.idle).toBe(true);
    emit({ type: "input" });
    expect(tracker.idle).toBe(false);
    expect(systemActivityDiagnostics()).toMatchObject({ available: true, inputs: 2 });

    stop();
    expect(unsubscribed).toBe(true);
  });

  it("a video of another program keeps the user present, Squorli's own video does not", () => {
    let now = 0;
    const tracker = new ActivityTracker(10 * MIN, () => now);
    let emit: (event: SystemActivityEvent) => void = () => {};
    watchSystemActivity(tracker, { subscribe: (cb) => { emit = cb; return () => {}; } });

    emit({ type: "display", required: true });
    now = 30 * MIN; tracker.check();
    expect(tracker.idle).toBe(false);
    // A camera comes on in the voice channel: the display state may be Squorli's own now. The gap still bridges two minutes.
    setOwnVideo(tracker, true);
    now = 33 * MIN; tracker.check();
    expect(tracker.idle).toBe(true);
    setOwnVideo(tracker, false);
    expect(tracker.idle).toBe(false);
    expect(systemActivityDiagnostics()).toMatchObject({ display: true, ownVideo: false });
    emit({ type: "display", required: false });
  });

  it("does nothing without a source (browser, older app)", () => {
    const tracker = new ActivityTracker(10 * MIN, () => 0);
    watchSystemActivity(tracker, null)();
    expect(systemActivityDiagnostics().available).toBe(false);
  });
});
