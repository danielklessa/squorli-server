import { describe, expect, it } from "vitest";
import { centeredSquare, toBase64 } from "./avatarImage";

describe("avatar image", () => {
  it("takes the centered square of landscape, portrait and square images", () => {
    expect(centeredSquare(720, 700)).toEqual({ side: 700, x: 10, y: 0 });
    expect(centeredSquare(300, 900)).toEqual({ side: 300, x: 0, y: 300 });
    expect(centeredSquare(256, 256)).toEqual({ side: 256, x: 0, y: 0 });
  });
  it("encodes bytes as base64, also beyond one chunk", () => {
    expect(toBase64(new TextEncoder().encode("abc"))).toBe("YWJj");
    const big = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 251);
    expect(Uint8Array.from(atob(toBase64(big)), (c) => c.charCodeAt(0))).toEqual(big);
  });
});
