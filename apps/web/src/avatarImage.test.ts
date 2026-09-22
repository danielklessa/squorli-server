import { describe, expect, it } from "vitest";
import { toBase64 } from "./avatarImage";

describe("avatar image", () => {
  it("encodes bytes as base64, also beyond one chunk", () => {
    expect(toBase64(new TextEncoder().encode("abc"))).toBe("YWJj");
    const big = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 251);
    expect(Uint8Array.from(atob(toBase64(big)), (c) => c.charCodeAt(0))).toEqual(big);
  });
});
