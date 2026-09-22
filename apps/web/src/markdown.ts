/**
 * Markdown for chat messages (channels and direct messages): pure parser, text -> tree. `MessageText.tsx` turns the tree into
 * React elements, so message text never becomes HTML. Deliberately a chat subset and no full CommonMark:
 * blocks = paragraph (a single line break stays a line break), heading # to ###, fenced code, quote "> ", lists (nested by
 * indentation), table (GFM: header row, delimiter row with optional alignment colons, body rows), rule; emoji (real ones,
 * `:shortcode:` and emoticons such as `:)`, see emoji/convert.ts); task list items "- [ ]" / "- [x]"; inline = `code`,
 * **strong**, *em* / _em_, ~~del~~, ==mark==, ~sub~, ^sup^, [text](url), <url>, bare URLs, backslash escapes.
 * Not supported on purpose: raw HTML, indented code, setext headings, embedded images (an image becomes a link, a
 * remote image would reveal the reader's IP address to a foreign host).
 */
import { readBareUrl } from "@squorli/protocol";
import { parseDeepLink } from "./platform/deepLink";
import { EMOTICON_STARTS, emoticonAt, shortcodeAt, splitEmoji } from "./emoji/convert";

export type Inline =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "code"; text: string }
  /** `source` = what was typed when the emoji was written as a shortcode or emoticon (":smile:", ":)"), else null. */
  | { type: "emoji"; text: string; source: string | null }
  /** `<@userId>`: a mentioned member (mentions.ts); the view resolves the current name. */
  | { type: "mention"; userId: string }
  | { type: "strong" | "em" | "del" | "mark" | "sub" | "sup"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

/** `checked` only exists on task list items ("- [ ] open", "- [x] done"). */
export type ListItem = { children: Inline[]; sub: ListBlock | null; checked?: boolean };
export type ListBlock = { type: "list"; ordered: boolean; start: number; items: ListItem[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "code"; lang: string | null; text: string }
  | { type: "quote"; children: Block[] }
  | ListBlock
  | TableBlock
  | { type: "rule" };

export type Align = "left" | "center" | "right" | null;
/** Every row has exactly as many cells as the header (`align.length`). */
export type TableBlock = { type: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] };

/** Quotes inside quotes: deeper levels stay plain text (bounds the recursion for ">" chains). */
const MAX_QUOTE_DEPTH = 6;
const MAX_LIST_DEPTH = 6;
/** More columns than this is no table any more (and nothing a chat could show). */
const MAX_TABLE_COLUMNS = 32;

const headingRe = /^ {0,3}(#{1,3})[ \t]+(\S.*)$/;
const ruleRe = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const quoteRe = /^ {0,3}>(?: (.*)|[ \t]*)$/;
const listRe = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/;
const fenceRe = /^ {0,3}```/;
const langRe = /^[\w+#.-]{1,32}$/;
const safeHrefRe = /^(?:https?:\/\/|mailto:)[^\s]+$/i;
/** Web and mail addresses, and of the app's own scheme only a server or invite link (`parseDeepLink`), never a command. */
const isSafeHref = (href: string): boolean => safeHrefRe.test(href) || (/^squorli:/i.test(href) && parseDeepLink(href) !== null);
/** Bare `squorli://server/...` or `squorli://invite/...` at `at`, trimmed like a bare web address (readBareUrl). */
function readBareSquorliLink(text: string, at: number): string | null {
  const m = /^squorli:\/\/[^\s<]+/i.exec(text.slice(at, at + 400));
  if (!m) return null;
  let url = m[0];
  while (/[.,;:!?*_~'"\])]$/.test(url)) url = url.slice(0, -1);
  return parseDeepLink(url) ? url : null;
}
const wordRe = /[\p{L}\p{N}]/u;
const escapableRe = /[!-/:-@[-`{-~]/;
const mentionRe = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/y;
const subRe = /~([^\s~]+)~(?!~)/y;
const supRe = /\^([^\s^]+)\^/y;
const taskRe = /^\[([ xX])\][ \t]+(\S.*)$/;

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }

    const table = fenceRe.test(line) ? null : readTable(lines, i);
    if (table) { out.push(table.block); i = table.next; continue; }

    if (fenceRe.test(line)) {
      const fence = readFence(lines, i);
      if (fence) { out.push(fence.block); i = fence.next; continue; }
    } else if (ruleRe.test(line)) {
      out.push({ type: "rule" }); i++; continue;
    } else if (headingRe.test(line)) {
      const m = headingRe.exec(line)!;
      out.push({ type: "heading", level: m[1]!.length as 1 | 2 | 3, children: parseInline(m[2]!.trimEnd()) }); i++; continue;
    } else if (depth < MAX_QUOTE_DEPTH && quoteRe.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && quoteRe.test(lines[i]!)) { inner.push(quoteRe.exec(lines[i]!)![1] ?? ""); i++; }
      out.push({ type: "quote", children: parseBlocks(inner, depth + 1) }); continue;
    } else if (listRe.test(line)) {
      const rows: ListRow[] = [];
      while (i < lines.length) {
        const m = listRe.exec(lines[i]!);
        if (!m || ruleRe.test(lines[i]!)) break;
        const row: ListRow = { indent: indentOf(m[1]!), ordered: /\d/.test(m[2]!), start: parseInt(m[2]!, 10) || 0, text: m[3]! };
        // "- a" followed by "1. b" on the same level are two lists, otherwise the number would get lost.
        if (rows[0] && row.indent < rows[0].indent + 2 && row.ordered !== rows[0].ordered) break;
        rows.push(row); i++;
      }
      out.push(buildList(rows, 0, rows.length, 1)); continue;
    }

    // Paragraph: always takes its first line (also an unclosed fence), then runs until a blank line or the next block.
    const para = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines, i, depth)) { para.push(lines[i]!); i++; }
    out.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  }
  return out;
}

function startsBlock(lines: string[], i: number, depth: number): boolean {
  const line = lines[i]!;
  if (fenceRe.test(line)) return readFence(lines, i) !== null;
  if (ruleRe.test(line) || readTable(lines, i)) return true;
  // As in CommonMark, a numbered line interrupts a paragraph only with 1 ("bis um\n18. Uhr" stays a sentence).
  const li = listRe.exec(line);
  if (li) return !/\d/.test(li[2]!) || parseInt(li[2]!, 10) === 1;
  return headingRe.test(line) || (depth < MAX_QUOTE_DEPTH && quoteRe.test(line));
}

/** ```lang … ``` over several lines, or ```code``` in one line. An unclosed fence is no code block (null). */
function readFence(lines: string[], at: number): { block: Block; next: number } | null {
  const first = lines[at]!.replace(/^ {0,3}```/, "");
  const oneLine = /^(.*?)```[ \t]*$/.exec(first);
  if (oneLine && oneLine[1]!.trim()) return { block: { type: "code", lang: null, text: oneLine[1]!.trim() }, next: at + 1 };
  if (oneLine) return null;
  const lang = langRe.test(first.trim()) ? first.trim() : null;
  const body: string[] = lang === null && first.trim() ? [first] : [];
  for (let i = at + 1; i < lines.length; i++) {
    const end = /^(.*?)```[ \t]*$/.exec(lines[i]!);
    if (!end) { body.push(lines[i]!); continue; }
    if (end[1]!.trim()) body.push(end[1]!);
    return { block: { type: "code", lang, text: body.join("\n") }, next: i + 1 };
  }
  return null;
}

/**
 * GFM table from the header row at `at`: the next line must be the delimiter row ("---", ":--", ":-:", "--:") with the same
 * number of cells, which is what tells a table from a sentence with a "|" in it. Body rows run until a blank line or a line
 * without "|"; they are cut or filled up to the header's width.
 */
function readTable(lines: string[], at: number): { block: TableBlock; next: number } | null {
  const headLine = lines[at]!, ruleLine = lines[at + 1];
  if (ruleLine === undefined || !headLine.includes("|") || !/^[ \t|:-]+$/.test(ruleLine) || !ruleLine.includes("-") || !ruleLine.includes("|")) return null;
  const head = splitRow(headLine), marks = splitRow(ruleLine);
  if (head.length !== marks.length || head.length > MAX_TABLE_COLUMNS || !marks.every((m) => /^:?-+:?$/.test(m))) return null;
  const align = marks.map((m): Align => (m.startsWith(":") && m.endsWith(":") ? "center" : m.endsWith(":") ? "right" : m.startsWith(":") ? "left" : null));
  const rows: Inline[][][] = [];
  let i = at + 2;
  for (; i < lines.length && lines[i]!.trim() && lines[i]!.includes("|"); i++) {
    const cells = splitRow(lines[i]!);
    rows.push(head.map((_, c) => parseInline(cells[c] ?? "")));
  }
  return { block: { type: "table", align, head: head.map((c) => parseInline(c)), rows }, next: i };
}

/** Cells of a table row: the outer pipes are optional, "\|" is a pipe inside a cell (also inside a code span, as in GFM). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

type ListRow = { indent: number; ordered: boolean; start: number; text: string };

const indentOf = (ws: string) => ws.replace(/\t/g, "    ").length;

/** Rows [from, to) with the indentation of the first row form one list; more deeply indented rows become the sublist of the row above. */
function buildList(rows: ListRow[], from: number, to: number, depth: number): ListBlock {
  const head = rows[from]!;
  const list: ListBlock = { type: "list", ordered: head.ordered, start: head.start, items: [] };
  let i = from;
  while (i < to) {
    const row = rows[i]!;
    i++;
    let end = i;
    if (depth < MAX_LIST_DEPTH) while (end < to && rows[end]!.indent >= head.indent + 2) end++;
    const task = taskRe.exec(row.text);
    const sub = end > i ? buildList(rows, i, end, depth + 1) : null;
    list.items.push(task ? { children: parseInline(task[2]!), sub, checked: task[1] !== " " } : { children: parseInline(row.text), sub });
    i = end;
  }
  return list;
}

// ---------- inline ----------

export function parseInline(text: string, inLink = false): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  // Real emoji in the text become nodes of their own, so the view can set them in the emoji font.
  const flush = () => {
    for (const piece of splitEmoji(buf)) out.push(piece.emoji ? { type: "emoji", text: piece.text, source: null } : { type: "text", text: piece.text });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;

    if (c === "\n") { flush(); out.push({ type: "br" }); i++; continue; }

    if (c === "\\" && i + 1 < text.length && escapableRe.test(text[i + 1]!)) { buf += text[i + 1]!; i += 2; continue; }

    if (c === "<" && text[i + 1] === "@") {
      mentionRe.lastIndex = i;
      const m = mentionRe.exec(text);
      if (m) { flush(); out.push({ type: "mention", userId: m[1]! }); i += m[0].length; continue; }
    }

    // Written emoji: ":smile:" and ":)" (emoji/convert.ts). Before everything else, "<3" and ":*" would otherwise be read as markup.
    const written = (c === ":" ? shortcodeAt(text, i) : null) ?? (EMOTICON_STARTS.has(c) ? emoticonAt(text, i) : null);
    if (written) { flush(); out.push({ type: "emoji", text: written.emoji, source: text.slice(i, i + written.length) }); i += written.length; continue; }

    if (c === "`") {
      const n = runLength(text, i);
      const close = codeSpanClose(text, i + n, n);
      if (close < 0) { buf += text.slice(i, i + n); i += n; continue; }
      let code = text.slice(i + n, close).replace(/\n/g, " ");
      if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
      flush(); out.push({ type: "code", text: code }); i = close + n; continue;
    }

    if (!inLink) {
      if (c === "<") {
        const m = /^<((?:https?:\/\/|mailto:|squorli:\/\/)[^\s<>]+)>/i.exec(text.slice(i, i + 2100));
        if (m && isSafeHref(m[1]!)) { flush(); out.push({ type: "link", href: m[1]!, children: [{ type: "text", text: m[1]!.replace(/^mailto:/i, "") }] }); i += m[0].length; continue; }
      }
      if (c === "[" || (c === "!" && text[i + 1] === "[")) {
        const link = readLink(text, c === "!" ? i + 1 : i);
        if (link) {
          flush();
          const label = link.children.length > 0 ? link.children : [{ type: "text" as const, text: link.href }];
          out.push({ type: "link", href: link.href, children: label }); i = link.next; continue;
        }
      }
      if ((c === "h" || c === "H" || c === "s" || c === "S") && !(i > 0 && wordRe.test(text[i - 1]!))) {
        const url = c === "h" || c === "H" ? readBareUrl(text, i) : readBareSquorliLink(text, i);
        if (url) { flush(); out.push({ type: "link", href: url, children: [{ type: "text", text: url }] }); i += url.length; continue; }
      }
    }

    // H~2~O and x^2^: a single "~" or "^" on both sides and nothing with white space between, so "~5 min, ~10 min" stays text.
    if (c === "^" || (c === "~" && runLength(text, i) === 1)) {
      const re = c === "^" ? supRe : subRe;
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) { flush(); out.push({ type: c === "^" ? "sup" : "sub", children: parseInline(m[1]!, inLink) }); i += m[0].length; continue; }
    }

    if (c === "*" || c === "_" || c === "~" || c === "=") {
      const n = runLength(text, i);
      const d = n >= 2 ? 2 : 1;
      const type = c === "~" ? "del" : c === "=" ? "mark" : d === 2 ? "strong" : "em";
      // "_" and "=" do not work inside words: snake_case, a==b.
      const opens = !((c === "~" || c === "=") && d === 1)
        && i + d < text.length && !/\s/.test(text[i + d]!)
        && !((c === "_" || c === "=") && i > 0 && wordRe.test(text[i - 1]!));
      const close = opens ? findCloser(text, i + d, c, d) : -1;
      // Content of nothing but the delimiter itself ("=====", a line drawn by hand) is no markup.
      if (close < 0 || [...text.slice(i + d, close)].every((ch) => ch === c)) { buf += c; i++; continue; }
      flush(); out.push({ type, children: parseInline(text.slice(i + d, close), inLink) }); i = close + d; continue;
    }

    buf += c; i++;
  }
  flush();
  return out;
}

function runLength(text: string, at: number): number {
  let n = 1;
  while (text[at + n] === text[at]) n++;
  return n;
}

/** Position of the closing run of exactly `n` backticks, or -1. */
function codeSpanClose(text: string, from: number, n: number): number {
  for (let i = from; i < text.length;) {
    if (text[i] !== "`") { i++; continue; }
    const run = runLength(text, i);
    if (run === n) return i;
    i += run;
  }
  return -1;
}

/**
 * Closing delimiter for emphasis opened before `from`. Code spans and escapes are skipped. In a longer run (`***`) the
 * delimiter sits at the end of the run, so `***a***` nests; a run of the other length (`*` while looking for `**` and the
 * other way round) belongs to a nested pair and is skipped.
 */
function findCloser(text: string, from: number, c: string, d: number): number {
  for (let i = from; i < text.length;) {
    const ch = text[i]!;
    if (ch === "\\") { i += 2; continue; }
    if (ch === "`") {
      const n = runLength(text, i);
      const close = codeSpanClose(text, i + n, n);
      i = close < 0 ? i + n : close + n; continue;
    }
    if (ch !== c) { i++; continue; }
    const n = runLength(text, i);
    const at = i + n - d;
    const fits = n === d || (n > d && n >= 3);
    const after = text[i + n];
    if (fits && at > from && !/\s/.test(text[i - 1]!) && !((c === "_" || c === "=") && after !== undefined && wordRe.test(after))) return at;
    i += n;
  }
  return -1;
}

/**
 * [text](url) or [text](url "title") from the "[" at `at`. Only http, https and mailto become links. A label that itself
 * looks like a web address is refused (a link showing one address and opening another is the classic phishing trick);
 * the text then stays literal and both addresses are linked as what they are.
 */
function readLink(text: string, at: number): { href: string; children: Inline[]; next: number } | null {
  let depth = 0, end = -1;
  for (let i = at; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") { i++; continue; }
    if (ch === "\n" && text[i + 1] === "\n") break;
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) { end = i; break; }
  }
  if (end < 0 || text[end + 1] !== "(") return null;
  let parens = 1, j = end + 2;
  for (; j < text.length; j++) {
    const ch = text[j]!;
    if (ch === "\n") return null;
    if (ch === "\\") { j++; continue; }
    if (ch === "(") parens++;
    else if (ch === ")" && --parens === 0) break;
  }
  if (j >= text.length) return null;
  const dest = /^\s*<?([^\s<>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*$/.exec(text.slice(end + 2, j));
  if (!dest) return null;
  const href = dest[1]!.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  if (!isSafeHref(href)) return null;
  const label = text.slice(at + 1, end);
  if (/^\s*(?:https?:\/\/|www\.)/i.test(label) && label.trim() !== href) return null;
  return { href, children: parseInline(label, true), next: j + 1 };
}

