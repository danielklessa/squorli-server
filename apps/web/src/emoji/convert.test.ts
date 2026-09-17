import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, type Inline } from "../markdown";
import { EMOTICONS, emoticonAt, shortcodeAt, splitEmoji } from "./convert";
import { SHORTCODES } from "./shortcodes";

const text = (s: string): Inline => ({ type: "text", text: s });
const emoji = (s: string, source: string | null = null): Inline => ({ type: "emoji", text: s, source });

describe("finding emoji", () => {
  it("cuts text into plain runs and single emoji", () => {
    expect(splitEmoji("a 😀😀 b")).toEqual([{ emoji: false, text: "a " }, { emoji: true, text: "😀" }, { emoji: true, text: "😀" }, { emoji: false, text: " b" }]);
  });
  it("keeps sequences together", () => {
    for (const e of ["🇩🇪", "👍🏽", "👨‍👩‍👧‍👦", "❤️‍🔥", "🏳️‍🌈", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "1️⃣", "#️⃣", "👩🏾‍⚕️", "☝🏽", "🧑‍💻"]) expect(splitEmoji(e)).toEqual([{ emoji: true, text: e }]);
  });
  it("leaves typography with text presentation alone", () => {
    for (const s of ["© 2026 Squorli™", "a ↔ b", "1 # 2 * 3", "♥ ☺ ✔", "№ 5 ‼"]) expect(splitEmoji(s)).toEqual([{ emoji: false, text: s }]);
    expect(splitEmoji("☺️")).toEqual([{ emoji: true, text: "☺️" }]);
  });
});

describe("written emoji", () => {
  it("knows the usual shortcodes of GitHub, Slack and Discord", () => {
    for (const [code, e] of [["smile", "😄"], ["+1", "👍"], ["thumbsup", "👍"], ["tada", "🎉"], ["slightly_smiling_face", "🙂"], ["joy", "😂"], ["100", "💯"], ["rocket", "🚀"]] as const) {
      expect(SHORTCODES[code]?.replace("\uFE0F", "")).toBe(e);
    }
    expect(shortcodeAt(":Rocket: los", 0)).toEqual({ emoji: "🚀", length: 8 });
  });
  it("ignores unknown names, object internals and codes inside words", () => {
    expect(shortcodeAt(":gibtesnicht:", 0)).toBeNull();
    expect(shortcodeAt(":constructor:", 0)).toBeNull();
    expect(shortcodeAt(":toString:", 0)).toBeNull();
    expect(shortcodeAt("12:100:45", 2)).toBeNull();
  });
  it("reads emoticons only as words of their own", () => {
    expect(emoticonAt("ok :)", 3)).toEqual({ emoji: "🙂", length: 2 });
    expect(emoticonAt("ok :-).", 3)).toEqual({ emoji: "🙂", length: 3 });
    expect(emoticonAt("http://x", 4)).toBeNull();
    expect(emoticonAt("C:/temp", 1)).toBeNull();
    expect(emoticonAt("xDrive", 0)).toBeNull();
    expect(emoticonAt(":Dabei", 0)).toBeNull();
    for (const e of Object.keys(EMOTICONS)) expect(emoticonAt(e, 0)).toEqual({ emoji: EMOTICONS[e], length: e.length });
  });
});

describe("emoji in messages", () => {
  it("converts shortcodes and emoticons and marks real emoji", () => {
    expect(parseInline("Hallo :wave: :) <3 😀!")).toEqual([
      text("Hallo "), emoji(SHORTCODES["wave"]!, ":wave:"), text(" "), emoji("🙂", ":)"), text(" "), emoji("❤️", "<3"), text(" "), emoji("😀"), text("!"),
    ]);
    expect(parseInline(":tada::tada:")).toEqual([emoji("🎉", ":tada:"), emoji("🎉", ":tada:")]);
    expect(parseInline("**:D**")).toEqual([{ type: "strong", children: [emoji("😃", ":D")] }]);
  });
  it("keeps code, addresses, times and escaped forms literal", () => {
    expect(parseInline("`:smile: :)`")).toEqual([{ type: "code", text: ":smile: :)" }]);
    expect(parseMarkdown("```\n:smile: :)\n```")).toEqual([{ type: "code", lang: null, text: ":smile: :)" }]);
    expect(parseInline("https://example.com/:smile:/x")).toEqual([{ type: "link", href: "https://example.com/:smile:/x", children: [text("https://example.com/:smile:/x")] }]);
    expect(parseInline("um 12:30:45 Uhr, Verhältnis 1:2")).toEqual([text("um 12:30:45 Uhr, Verhältnis 1:2")]);
    expect(parseInline("\\:) und \\:smile:")).toEqual([text(":) und :smile:")]);
  });
  it("does not mistake a table's alignment row or a quote for emoticons", () => {
    expect(parseMarkdown("| a |\n|:-:|\n| :) |")).toEqual([{ type: "table", align: ["center"], head: [[text("a")]], rows: [[[emoji("🙂", ":)")]]] }]);
    expect(parseMarkdown(">:( nein")).toEqual([{ type: "paragraph", children: [emoji("😠", ">:("), text(" nein")] }]);
  });
});
