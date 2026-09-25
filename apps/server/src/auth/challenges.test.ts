import { describe, expect, it } from "vitest";
import { ChallengeStore, RateLimiter } from "./challenges";

describe("ChallengeStore", () => {
  it("is single-use", () => {
    const s = new ChallengeStore();
    const c = s.create("aa");
    expect(s.consume(c.challengeId, "aa")).toBe(c.nonce);
    expect(s.consume(c.challengeId, "aa")).toBeNull();
  });
  it("rejects wrong key", () => {
    const s = new ChallengeStore();
    const c = s.create("aa");
    expect(s.consume(c.challengeId, "bb")).toBeNull();
  });
  it("expires", () => {
    const s = new ChallengeStore(-1);
    const c = s.create("aa");
    expect(s.consume(c.challengeId, "aa")).toBeNull();
  });
});

describe("RateLimiter attempts", () => {
  it("counts before the check completes, so parallel attempts cannot pass together; a success gives its attempt back", () => {
    const l = new RateLimiter(2);
    expect(l.attempt("ip")).toBe(true);
    expect(l.attempt("ip")).toBe(true);
    expect(l.attempt("ip")).toBe(false);
    l.refund("ip");
    expect(l.attempt("ip")).toBe(true);
    expect(l.attempt("ip")).toBe(false);
  });
});
