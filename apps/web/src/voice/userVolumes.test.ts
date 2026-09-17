import { describe, expect, it } from "vitest";
import { clampUserVolume, parseUserVolumes, withUserVolume } from "./userVolumes";

describe("user volumes", () => {
  it("clamps to 0..200 % and treats nonsense as 100 %", () => {
    expect(clampUserVolume(-1)).toBe(0);
    expect(clampUserVolume(0.4)).toBe(0.4);
    expect(clampUserVolume(3)).toBe(2);
    expect(clampUserVolume(Number.NaN)).toBe(1);
    expect(clampUserVolume("2")).toBe(1);
  });

  it("reads stored volumes and ignores broken data", () => {
    expect(parseUserVolumes(null)).toEqual({});
    expect(parseUserVolumes("{oops")).toEqual({});
    expect(parseUserVolumes("[1,2]")).toEqual({});
    expect(parseUserVolumes(JSON.stringify({ a: 0.5, b: 9, c: "x", d: 1 }))).toEqual({ a: 0.5, b: 2 });
  });

  it("stores only real adjustments", () => {
    const one = withUserVolume({}, "a", 1.5);
    expect(one).toEqual({ a: 1.5 });
    expect(withUserVolume(one, "b", 0)).toEqual({ a: 1.5, b: 0 });
    expect(withUserVolume(one, "a", 1)).toEqual({});
    expect(one).toEqual({ a: 1.5 }); // not mutated
  });
});
