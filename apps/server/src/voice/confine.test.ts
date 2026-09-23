import { describe, expect, it } from "vitest";
import { MOVE_GRANT_MS, MoveGrants, confinementVerdict } from "./confine";

describe("confinementVerdict", () => {
  it("lets everybody through who is not held", () => {
    expect(confinementVerdict({ bypass: false, confinedTo: null, wanted: "b", granted: false })).toBe("ok");
  });
  it("refuses every other channel while held, but not the holding one", () => {
    expect(confinementVerdict({ bypass: false, confinedTo: "a", wanted: "b", granted: false })).toBe("confined");
    expect(confinementVerdict({ bypass: false, confinedTo: "a", wanted: "a", granted: false })).toBe("ok");
  });
  it("a moderator's move (the grant) and BYPASS_STICKY open the way", () => {
    expect(confinementVerdict({ bypass: false, confinedTo: "a", wanted: "b", granted: true })).toBe("ok");
    expect(confinementVerdict({ bypass: true, confinedTo: "a", wanted: "b", granted: false })).toBe("ok");
  });
});

describe("MoveGrants", () => {
  it("names the channel for a minute and is used up by the join", () => {
    const g = new MoveGrants();
    g.grant("u", "x", 1000);
    expect(g.grantOf("u", 1000)).toBe("x");
    expect(g.grantOf("u", 1000 + MOVE_GRANT_MS)).toBeUndefined();
    g.grant("u", "x", 1000);
    g.consume("u", "y");
    expect(g.grantOf("u", 1000)).toBe("x");
    g.consume("u", "x");
    expect(g.grantOf("u", 1000)).toBeUndefined();
  });
});
