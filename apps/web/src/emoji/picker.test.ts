import { describe, expect, it } from "vitest";
import { GROUPS as DE } from "./data.de";
import { GROUPS as EN } from "./data.en";
import { emojiWithTone, entriesOf, firstShortcode, insertAt, pushRecent, searchEmoji } from "./picker";
import { splitEmoji } from "./convert";

const chars = (list: { 0: string }[]) => list.map((e) => e[0].replace("️", ""));

describe("emoji data", () => {
  it("has the same emoji in both languages, grouped, without the component group", () => {
    expect(DE.map((g) => g.key)).toEqual(["smileys-emotion", "people-body", "animals-nature", "food-drink", "travel-places", "activities", "objects", "symbols", "flags"]);
    expect(EN.map((g) => g.emojis.map((e) => e[0]))).toEqual(DE.map((g) => g.emojis.map((e) => e[0])));
    expect(DE.reduce((n, g) => n + g.emojis.length, 0)).toBeGreaterThan(1800);
  });
  it("only lists emoji the message view recognizes as one emoji", () => {
    const odd = DE.flatMap((g) => g.emojis).flatMap((e) => [e[0], ...(e[4] ?? [])]).filter((c) => { const p = splitEmoji(c); return p.length !== 1 || !p[0]!.emoji; });
    expect(odd).toEqual([]);
  });
});

describe("emoji picker logic", () => {
  it("searches names, keywords and shortcodes in the client's language", () => {
    expect(chars(searchEmoji(DE, "lachen"))).toContain("😂");
    expect(chars(searchEmoji(DE, "Flagge Deutschland"))).toEqual(["🇩🇪"]);
    expect(chars(searchEmoji(EN, "germany"))).toEqual(["🇩🇪"]);
    expect(chars(searchEmoji(DE, ":thumbsup"))[0]).toBe("👍");
    expect(chars(searchEmoji(DE, ":rocket:"))).toEqual(["🚀"]);
    expect(searchEmoji(DE, "   ")).toEqual([]);
    expect(searchEmoji(DE, "gibtesganzsichernicht")).toEqual([]);
  });
  it("puts hits that start with the query first and limits the list", () => {
    expect(["🐱", "🐈"]).toContain(chars(searchEmoji(EN, "cat"))[0]);
    expect(searchEmoji(EN, "a", 10)).toHaveLength(10);
  });
  it("applies the skin tone where an emoji has one", () => {
    const wave = searchEmoji(EN, "waving hand")[0]!, rocket = searchEmoji(EN, "rocket")[0]!;
    expect(emojiWithTone(wave, 0)).toBe("👋");
    expect(emojiWithTone(wave, 3)).toBe("👋🏽");
    expect(emojiWithTone(rocket, 3)).toBe("🚀");
    expect(firstShortcode(wave)).toBe("wave");
  });
  it("finds stored emoji again, also with a skin tone, and drops unknown ones", () => {
    expect(entriesOf(DE, ["👋🏽", "kein emoji", "🚀"]).map((e) => e[0])).toEqual(["👋🏽", "🚀"]);
  });
  it("keeps the recent list short, newest first, without duplicates", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
  it("inserts at the caret and replaces a selection", () => {
    expect(insertAt("Hallo Welt", 5, 5, " 👋")).toEqual({ value: "Hallo 👋 Welt", caret: 8 });
    expect(insertAt("Hallo Welt", 6, 10, "🌍")).toEqual({ value: "Hallo 🌍", caret: 8 });
    expect(insertAt("abc", 99, 99, "!")).toEqual({ value: "abc!", caret: 4 });
  });
});
