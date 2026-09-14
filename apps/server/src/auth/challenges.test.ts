import { describe, expect, it } from "vitest";
import { ChallengeStore } from "./challenges";

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
