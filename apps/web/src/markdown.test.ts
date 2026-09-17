import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, type Inline } from "./markdown";

const text = (s: string): Inline => ({ type: "text", text: s });
const link = (href: string, label = href): Inline => ({ type: "link", href, children: [text(label)] });
const para = (...children: Inline[]) => ({ type: "paragraph", children });

describe("markdown inline", () => {
  it("leaves plain text alone", () => {
    expect(parseInline("Hallo Welt, 2 * 3 = 6 und a_b_c")).toEqual([text("Hallo Welt, 2 * 3 = 6 und a_b_c")]);
  });
  it("parses strong, em, del and code", () => {
    expect(parseInline("**fett** *kursiv* _auch_ __fett__ ~~weg~~ `code`")).toEqual([
      { type: "strong", children: [text("fett")] }, text(" "),
      { type: "em", children: [text("kursiv")] }, text(" "),
      { type: "em", children: [text("auch")] }, text(" "),
      { type: "strong", children: [text("fett")] }, text(" "),
      { type: "del", children: [text("weg")] }, text(" "),
      { type: "code", text: "code" },
    ]);
  });
  it("nests emphasis", () => {
    expect(parseInline("***beides***")).toEqual([{ type: "strong", children: [{ type: "em", children: [text("beides")] }] }]);
    expect(parseInline("*a **b** c*")).toEqual([{ type: "em", children: [text("a "), { type: "strong", children: [text("b")] }, text(" c")] }]);
    expect(parseInline("**a *b***")).toEqual([{ type: "strong", children: [text("a "), { type: "em", children: [text("b")] }] }]);
  });
  it("parses highlight, subscript and superscript", () => {
    expect(parseInline("==wichtig== und ==**sehr** wichtig==")).toEqual([
      { type: "mark", children: [text("wichtig")] }, text(" und "),
      { type: "mark", children: [{ type: "strong", children: [text("sehr")] }, text(" wichtig")] },
    ]);
    expect(parseInline("H~2~O, E = mc^2^, 10^-3^ und x~i~^2^")).toEqual([
      text("H"), { type: "sub", children: [text("2")] }, text("O, E = mc"), { type: "sup", children: [text("2")] }, text(", 10"),
      { type: "sup", children: [text("-3")] }, text(" und x"), { type: "sub", children: [text("i")] }, { type: "sup", children: [text("2")] },
    ]);
  });
  it("keeps comparisons, rough figures and hand-drawn lines literal", () => {
    for (const s of ["if a==b and c==d", "x == y == z", "~5 Minuten, ~10 Euro", "2^10 ist 1024", "a ^ b ^ c", "=====", "a = b", "~~~"]) expect(parseInline(s)).toEqual([text(s)]);
    expect(parseInline("~~weg~~ bleibt durchgestrichen")).toEqual([{ type: "del", children: [text("weg")] }, text(" bleibt durchgestrichen")]);
  });
  it("keeps unmatched delimiters literal", () => {
    expect(parseInline("**offen")).toEqual([text("**offen")]);
    expect(parseInline("**a*")).toEqual([text("*"), { type: "em", children: [text("a")] }]);
    expect(parseInline("a ~ b ~~ c")).toEqual([text("a ~ b ~~ c")]);
    expect(parseInline("`offen")).toEqual([text("`offen")]);
    expect(parseInline("****")).toEqual([text("****")]);
  });
  it("does not read emphasis inside words with underscores", () => {
    expect(parseInline("snake_case_name und _x_y")).toEqual([text("snake_case_name und _x_y")]);
  });
  it("does not look into code spans", () => {
    expect(parseInline("``a ` **b**``")).toEqual([{ type: "code", text: "a ` **b**" }]);
    expect(parseInline("*a `*` b*")).toEqual([{ type: "em", children: [text("a "), { type: "code", text: "*" }, text(" b")] }]);
  });
  it("honours backslash escapes", () => {
    expect(parseInline("\\*kein\\* \\\\ C:\\temp")).toEqual([text("*kein* \\ C:\\temp")]);
  });
  it("turns line breaks into br", () => {
    expect(parseInline("a\nb")).toEqual([text("a"), { type: "br" }, text("b")]);
  });
  it("links bare addresses without the sentence punctuation", () => {
    expect(parseInline("siehe https://example.com/a_b_c?x=1.")).toEqual([text("siehe "), link("https://example.com/a_b_c?x=1"), text(".")]);
    expect(parseInline("(https://de.wikipedia.org/wiki/Rust_(Programmiersprache))")).toEqual([text("("), link("https://de.wikipedia.org/wiki/Rust_(Programmiersprache)"), text(")")]);
    expect(parseInline("**https://example.com**")).toEqual([{ type: "strong", children: [link("https://example.com")] }]);
    expect(parseInline("xhttps://example.com https://")).toEqual([text("xhttps://example.com https://")]);
  });
  it("parses masked links, autolinks and images as links", () => {
    expect(parseInline("[Doku](https://squorli.com/docs \"Titel\")")).toEqual([link("https://squorli.com/docs", "Doku")]);
    expect(parseInline("[**fett**](https://squorli.com)")).toEqual([{ type: "link", href: "https://squorli.com", children: [{ type: "strong", children: [text("fett")] }] }]);
    expect(parseInline("<https://squorli.com> <mailto:a@b.de>")).toEqual([link("https://squorli.com"), text(" "), link("mailto:a@b.de", "a@b.de")]);
    expect(parseInline("![Bild](https://example.com/a.png)")).toEqual([link("https://example.com/a.png", "Bild")]);
  });
  it("refuses dangerous and misleading links", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([text("[x](javascript:alert(1))")]);
    expect(parseInline("[x](data:text/html,hi)")).toEqual([text("[x](data:text/html,hi)")]);
    expect(parseInline("<javascript:alert(1)>")).toEqual([text("<javascript:alert(1)>")]);
    // A label that looks like another address is not masked: both addresses show as what they are.
    expect(parseInline("[https://bank.de](https://evil.example)")).toEqual([text("["), link("https://bank.de"), text("]("), link("https://evil.example"), text(")")]);
  });
});

describe("markdown blocks", () => {
  it("keeps single line breaks and separates paragraphs at blank lines", () => {
    expect(parseMarkdown("a\nb\n\n\nc")).toEqual([para(text("a"), { type: "br" }, text("b")), para(text("c"))]);
    expect(parseMarkdown("a\r\nb")).toEqual([para(text("a"), { type: "br" }, text("b"))]);
  });
  it("parses headings up to level 3", () => {
    expect(parseMarkdown("# Eins\n## Zwei\n### Drei\n#### Vier\n#kanal")).toEqual([
      { type: "heading", level: 1, children: [text("Eins")] },
      { type: "heading", level: 2, children: [text("Zwei")] },
      { type: "heading", level: 3, children: [text("Drei")] },
      para(text("#### Vier"), { type: "br" }, text("#kanal")),
    ]);
  });
  it("parses fenced code without touching its content", () => {
    expect(parseMarkdown("```ts\nconst a = **1**;\n\n  <b>x</b>\n```\ndanach")).toEqual([
      { type: "code", lang: "ts", text: "const a = **1**;\n\n  <b>x</b>" },
      para(text("danach")),
    ]);
    expect(parseMarkdown("```einzeilig **x**```")).toEqual([{ type: "code", lang: null, text: "einzeilig **x**" }]);
    expect(parseMarkdown("```kein lang\nb```")).toEqual([{ type: "code", lang: null, text: "kein lang\nb" }]);
  });
  it("treats an unclosed fence as text", () => {
    expect(parseMarkdown("```js\noffen")).toEqual([para(text("```js"), { type: "br" }, text("offen"))]);
  });
  it("parses quotes, also nested, and needs the space", () => {
    expect(parseMarkdown("> a\n> > b\n>\n> c\n>kein Zitat")).toEqual([
      { type: "quote", children: [para(text("a")), { type: "quote", children: [para(text("b"))] }, para(text("c"))] },
      para(text(">kein Zitat")),
    ]);
  });
  it("bounds quote nesting", () => {
    const blocks = parseMarkdown("> ".repeat(500) + "x");
    let depth = 0;
    for (let b = blocks[0]; b?.type === "quote"; b = b.children[0]) depth++;
    expect(depth).toBe(6);
  });
  it("parses lists with nesting and start number", () => {
    expect(parseMarkdown("- a\n  - a1\n  - a2\n- **b**")).toEqual([{
      type: "list", ordered: false, start: 0, items: [
        { children: [text("a")], sub: { type: "list", ordered: false, start: 0, items: [{ children: [text("a1")], sub: null }, { children: [text("a2")], sub: null }] } },
        { children: [{ type: "strong", children: [text("b")] }], sub: null },
      ],
    }]);
    expect(parseMarkdown("3. drei\n4) vier")).toEqual([{ type: "list", ordered: true, start: 3, items: [{ children: [text("drei")], sub: null }, { children: [text("vier")], sub: null }] }]);
  });
  it("splits bullet and numbered lists and keeps sentences with numbers", () => {
    expect(parseMarkdown("- a\n1. b").map((b) => b.type === "list" && b.ordered)).toEqual([false, true]);
    expect(parseMarkdown("bis um\n18. Uhr")).toEqual([para(text("bis um"), { type: "br" }, text("18. Uhr"))]);
    expect(parseMarkdown("-kein Punkt\n*kursiv* am Anfang")).toEqual([para(text("-kein Punkt"), { type: "br" }, { type: "em", children: [text("kursiv")] }, text(" am Anfang"))]);
  });
  it("parses task lists", () => {
    expect(parseMarkdown("- [ ] offen\n- [x] fertig\n  - [X] auch\n- normal\n- [] kein Task")).toEqual([{
      type: "list", ordered: false, start: 0, items: [
        { children: [text("offen")], sub: null, checked: false },
        { children: [text("fertig")], checked: true, sub: { type: "list", ordered: false, start: 0, items: [{ children: [text("auch")], sub: null, checked: true }] } },
        { children: [text("normal")], sub: null },
        { children: [text("[] kein Task")], sub: null },
      ],
    }]);
    expect(parseMarkdown("1. [x] nummeriert")).toEqual([{ type: "list", ordered: true, start: 1, items: [{ children: [text("nummeriert")], sub: null, checked: true }] }]);
  });
  it("parses rules and lets blocks interrupt a paragraph", () => {
    expect(parseMarkdown("a\n---\n- b\n> c")).toEqual([
      para(text("a")), { type: "rule" },
      { type: "list", ordered: false, start: 0, items: [{ children: [text("b")], sub: null }] },
      { type: "quote", children: [para(text("c"))] },
    ]);
  });
  it("parses tables with alignment and inline formatting", () => {
    expect(parseMarkdown("| Name | Wert | Mitte |\n|:--|--:|:-:|\n| `a` | **1** | x |\nb | 2 | y")).toEqual([{
      type: "table", align: ["left", "right", "center"],
      head: [[text("Name")], [text("Wert")], [text("Mitte")]],
      rows: [
        [[{ type: "code", text: "a" }], [{ type: "strong", children: [text("1")] }], [text("x")]],
        [[text("b")], [text("2")], [text("y")]],
      ],
    }]);
  });
  it("fits table rows to the header and honours escaped pipes", () => {
    expect(parseMarkdown("a | b\n--- | ---\n1\\|2 | 3 | zu viel\n| nur eins |")).toEqual([{
      type: "table", align: [null, null], head: [[text("a")], [text("b")]],
      rows: [[[text("1|2")], [text("3")]], [[text("nur eins")], []]],
    }]);
  });
  it("ends a table at a blank line or a line without a pipe and lets it interrupt a paragraph", () => {
    expect(parseMarkdown("davor\n| a |\n|---|\n| 1 |\ndanach").map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(parseMarkdown("| a |\n|---|\n\n| 1 |").map((b) => b.type)).toEqual(["table", "paragraph"]);
  });
  it("needs a matching delimiter row for a table", () => {
    expect(parseMarkdown("a | b\n---").map((b) => b.type)).toEqual(["paragraph", "rule"]);
    expect(parseMarkdown("a | b\n--- | --- | ---")).toEqual([para(text("a | b"), { type: "br" }, text("--- | --- | ---"))]);
    expect(parseMarkdown("entweder | oder")).toEqual([para(text("entweder | oder"))]);
    expect(parseMarkdown("```\na | b\n--- | ---\n```")).toEqual([{ type: "code", lang: null, text: "a | b\n--- | ---" }]);
  });
  it("stays fast on hostile input", () => {
    const started = Date.now();
    for (const s of ["*a ".repeat(1300), "[".repeat(4000), "`".repeat(3999) + "x", "**".repeat(2000), "_a_".repeat(1300), "https://" + "a.".repeat(1990), "- ".repeat(2000), "|".repeat(2000) + "\n" + "-|".repeat(1000), "a|b\n" + "-".repeat(3990) + "x", "a|b\n-|-\n" + "|".repeat(3900)]) parseMarkdown(s);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
