import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { AUTO_TRIES, TRIES_AFTER_USER, freshPlan, nextTry, planAfterUser, retryDelayFor, sessionRejected } from "./serverRetry";

const answer = (status: number) => new ApiError("GET", "/api/me", status, null, {});

describe("sessionRejected", () => {
  it("drops the session only when the server refused it", () => {
    expect(sessionRejected(answer(401))).toBe(true);
    expect(sessionRejected(answer(403))).toBe(true);
    expect(sessionRejected(answer(404))).toBe(true);
  });
  it("keeps the session when the server did not answer", () => {
    expect(sessionRejected(new TypeError("Failed to fetch"))).toBe(false); // connection refused, DNS, offline
    expect(sessionRejected(answer(502))).toBe(false); // a proxy in front of a stopped server
    expect(sessionRejected(answer(503))).toBe(false);
    expect(sessionRejected(answer(429))).toBe(false); // rate limit
    expect(sessionRejected(answer(408))).toBe(false);
    expect(sessionRejected(new Error("unexpected shape"))).toBe(false);
  });
});

describe("nextTry", () => {
  const drain = (start: ReturnType<typeof freshPlan>) => {
    const delays: (number | null)[] = [];
    let plan = start;
    for (let i = 0; i < 12; i++) { const r = nextTry(plan); plan = r.plan; delays.push(r.delay); }
    return delays;
  };
  it("runs ten tries by itself, in the cadence, then waits for the user", () => {
    expect(AUTO_TRIES).toBe(10);
    expect(drain(freshPlan())).toEqual([15_000, 30_000, 30_000, 30_000, 30_000, 60_000, 60_000, 60_000, 60_000, 60_000, null, null]);
  });
  it("after the user pressed: five tries a minute apart, then waits again", () => {
    expect(TRIES_AFTER_USER).toBe(5);
    expect(drain(planAfterUser())).toEqual([60_000, 60_000, 60_000, 60_000, 60_000, null, null, null, null, null, null, null]);
  });
});

describe("retryDelayFor", () => {
  it("waits 15 s once, 30 s for the 2nd to 5th try, then a minute each", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelayFor)).toEqual([15_000, 30_000, 30_000, 30_000, 30_000, 60_000, 60_000, 60_000]);
  });
});
