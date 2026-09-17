import { describe, expect, it } from "vitest";
import { ActivityTracker } from "./activity";

const MIN = 60_000;
function setup() {
  let now = 0;
  const tracker = new ActivityTracker(5 * MIN, () => now);
  const seen: boolean[] = [];
  tracker.subscribe((idle) => seen.push(idle));
  return { tracker, seen, at: (t: number) => { now = t; tracker.check(); } };
}

describe("ActivityTracker", () => {
  it("turns idle after five minutes without activity and comes back on the first touch", () => {
    const { tracker, seen, at } = setup();
    at(4 * MIN + 59_000);
    expect(tracker.idle).toBe(false);
    at(5 * MIN);
    expect(tracker.idle).toBe(true);
    tracker.touch();
    expect(tracker.idle).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("counts from the last activity (input or speech)", () => {
    const { tracker, at } = setup();
    at(4 * MIN); tracker.touch();
    at(8 * MIN);
    expect(tracker.idle).toBe(false);
    at(9 * MIN);
    expect(tracker.idle).toBe(true);
  });

  it("never turns idle while the system-wide detector reports the user active", () => {
    const { tracker, at } = setup();
    tracker.setSystemIdle(false);
    at(30 * MIN);
    expect(tracker.idle).toBe(false);
    // The detector gives up (idle or screen locked): now the five minutes without input or speech decide, and they are over.
    tracker.setSystemIdle(true);
    expect(tracker.idle).toBe(true);
  });

  it("keeps somebody present who talks while the system is idle", () => {
    const { tracker, at } = setup();
    tracker.setSystemIdle(true);
    at(4 * MIN); tracker.touch(); // speaking
    at(6 * MIN);
    expect(tracker.idle).toBe(false);
  });

  it("system activity ends an absence", () => {
    const { tracker, seen, at } = setup();
    tracker.setSystemIdle(true);
    at(5 * MIN);
    tracker.setSystemIdle(false);
    expect(seen).toEqual([true, false]);
  });
});
