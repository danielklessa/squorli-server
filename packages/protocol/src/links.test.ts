import { describe, expect, it } from "vitest";
import { MAX_PREVIEW_LINKS, previewLinks, readBareUrl } from "./links";

describe("previewLinks", () => {
  it("finds bare addresses and leaves the sentence's punctuation alone", () => {
    expect(previewLinks("Schau mal: https://example.org/a_(b), und https://example.com/x?y=1!")).toEqual(["https://example.org/a_(b)", "https://example.com/x?y=1"]);
    expect(previewLinks("(siehe https://example.org/seite)")).toEqual(["https://example.org/seite"]);
  });

  it("takes the target of a masked link", () => {
    expect(previewLinks("[die Seite](https://example.org/seite) ist gut")).toEqual(["https://example.org/seite"]);
    expect(previewLinks("[https://example.org](https://example.org)")).toEqual(["https://example.org"]);
  });

  it("gives no preview to an address in angle brackets, in code or behind a backslash", () => {
    expect(previewLinks("<https://example.org/still>")).toEqual([]);
    expect(previewLinks("`https://example.org` und ``x https://example.com ``")).toEqual([]);
    expect(previewLinks("```\nhttps://example.org\n```\nhttps://example.com")).toEqual(["https://example.com"]);
    expect(previewLinks("> ```\n> https://example.org\n> ```")).toEqual([]);
    expect(previewLinks("nohttps://example.org")).toEqual([]);
  });

  it("an unclosed fence is no code", () => {
    expect(previewLinks("```\nhttps://example.org")).toEqual(["https://example.org"]);
  });

  it("reports an address once and at most MAX_PREVIEW_LINKS", () => {
    expect(previewLinks("https://a.example https://a.example")).toEqual(["https://a.example"]);
    const many = Array.from({ length: 6 }, (_, i) => `https://example.org/${i}`);
    expect(previewLinks(many.join(" "))).toEqual(many.slice(0, MAX_PREVIEW_LINKS));
  });

  it("needs a host and http(s)", () => {
    expect(previewLinks("https:// ftp://example.org mailto:a@example.org")).toEqual([]);
    expect(readBareUrl("https://", 0)).toBeNull();
  });
});
