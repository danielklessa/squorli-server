import { describe, expect, it } from "vitest";
import { grownHeight } from "./autoGrow";

describe("growing text input", () => {
  it("follows the content below a third of the area", () => {
    expect(grownHeight(38, 900)).toEqual({ height: 38, scroll: false });
    expect(grownHeight(300, 900)).toEqual({ height: 300, scroll: false });
  });
  it("stops at a third and scrolls from there", () => {
    expect(grownHeight(301, 900)).toEqual({ height: 300, scroll: true });
    expect(grownHeight(5000, 1000)).toEqual({ height: 333, scroll: true });
  });
  it("does not squash the input while the area has no height", () => {
    expect(grownHeight(38, 0)).toEqual({ height: 38, scroll: false });
  });
  it("keeps about two lines on a very low area", () => {
    expect(grownHeight(60, 120)).toEqual({ height: 60, scroll: false });
    expect(grownHeight(200, 120)).toEqual({ height: 64, scroll: true });
  });
});
