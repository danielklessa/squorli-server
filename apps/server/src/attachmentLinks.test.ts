import { describe, expect, it } from "vitest";
import { LINK_DAYS, setLinkSecret, signAttachment, verifyAttachment } from "./attachmentLinks";

const DAY = 86_400_000;
setLinkSecret(Buffer.alloc(32, 7));
const q = (id: string, now: number) => Object.fromEntries(new URLSearchParams(signAttachment(id, now)));

describe("signed attachment links", () => {
  const now = Date.UTC(2026, 8, 25, 15, 0);
  it("verify for their attachment until the expiry, at least LINK_DAYS", () => {
    const { e, s } = q("a", now);
    expect(verifyAttachment("a", e, s, now)).toBe(true);
    expect(verifyAttachment("a", e, s, now + LINK_DAYS * DAY)).toBe(true);
    expect(verifyAttachment("a", e, s, now + (LINK_DAYS + 1) * DAY)).toBe(false);
  });
  it("stay the same for a whole day (browser cache)", () => {
    expect(signAttachment("a", Date.UTC(2026, 8, 25, 0, 1))).toBe(signAttachment("a", Date.UTC(2026, 8, 25, 23, 59)));
  });
  it("refuse another attachment, a changed expiry, a missing or foreign signature", () => {
    const { e, s } = q("a", now);
    expect(verifyAttachment("b", e, s, now)).toBe(false);
    expect(verifyAttachment("a", String(Number(e) + 86_400), s, now)).toBe(false);
    expect(verifyAttachment("a", undefined, undefined, now)).toBe(false);
    expect(verifyAttachment("a", e, "x".repeat(32), now)).toBe(false);
    setLinkSecret(Buffer.alloc(32, 8));
    expect(verifyAttachment("a", e, s, now)).toBe(false);
    setLinkSecret(Buffer.alloc(32, 7));
  });
});
