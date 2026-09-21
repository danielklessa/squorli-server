import { previewLinks } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";

/** Every address the view shows as a link, in order. */
function shownLinks(content: string): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (!node || typeof node !== "object") return;
    const n = node as { type?: unknown; href?: unknown };
    if (n.type === "link" && typeof n.href === "string") found.push(n.href);
    for (const value of Object.values(node)) walk(value);
  };
  walk(parseMarkdown(content));
  return found;
}

const real = (c: string) => c.replaceAll("FENCE", "BTBTBT").replaceAll("BT", String.fromCharCode(96));

describe("links that get a preview (server scanner against the parser)", () => {
  it("previews exactly the http(s) links the view shows, except the ones in angle brackets", () => {
    const cases: [string, string[]][] = [
      ["siehe https://example.org/a.", ["https://example.org/a"]],
      ["**https://example.org/fett**", ["https://example.org/fett"]],
      ["[Text](https://example.org/maskiert) und (https://example.com/klammer)", ["https://example.org/maskiert", "https://example.com/klammer"]],
      ["> https://example.org/zitat", ["https://example.org/zitat"]],
      ["- [x] https://example.org/liste", ["https://example.org/liste"]],
      ["| a |\n|---|\n| https://example.org/tabelle |", ["https://example.org/tabelle"]],
      ["FENCE\noffen https://example.org/offen", ["https://example.org/offen"]],
      ["a\nhttps://example.org/zeile\nb", ["https://example.org/zeile"]],
    ];
    for (const [c, links] of cases.map(([c, l]) => [real(c), l] as const)) {
      expect([c, previewLinks(c)]).toEqual([c, links]);
      for (const url of links) expect([c, shownLinks(c).includes(url)]).toEqual([c, true]);
    }
  });

  it("never previews what the view does not show as a link", () => {
    const none = ["BThttps://example.org/codeBT", "FENCE\nhttps://example.org/zaun\nFENCE", "> FENCE\n> https://example.org/zitat\n> FENCE", "xhttps://example.org/wort", "\\https://example.org/maskiert"];
    for (const c of none.map(real)) {
      const previews = previewLinks(c);
      for (const url of previews) expect([c, url, shownLinks(c).includes(url)]).toEqual([c, url, true]);
    }
    expect(previewLinks(real("BThttps://example.org/codeBT"))).toEqual([]);
    expect(previewLinks(real("FENCE\nhttps://example.org/zaun\nFENCE"))).toEqual([]);
  });

  it("an address in angle brackets is a link without a preview", () => {
    expect(shownLinks("<https://example.org/still>")).toEqual(["https://example.org/still"]);
    expect(previewLinks("<https://example.org/still>")).toEqual([]);
  });
});
