/**
 * Reads a message text the way the web client's Markdown parser (apps/web/src/markdown.ts) does, as far as "is this inside
 * code" goes, for the places that have no parser: the server counts mentions (mentions.ts) and looks for the links that get
 * a preview (links.ts). Skipped: fenced code (also inside quotes, an unclosed fence is no code), code spans (a run of n
 * backticks closes with a run of n, inside one block of lines) and whatever follows a backslash. The web tests compare both
 * users with the parser. Where scanner and parser could still differ (a span broken across list items), the scanner says
 * "not found": no false alarms.
 */
const MAX_QUOTE_DEPTH = 6;   // as in the parser: deeper ">" levels stay plain text
const quoteRe = /^ {0,3}>(?: (.*)|[ \t]*)$/;
const fenceRe = /^ {0,3}```/;
const closeRe = /^(.*?)```[ \t]*$/;
const escapableRe = /[!-/:-@[-`{-~]/;

/** What a matcher found at a position: `length` characters are consumed, `value` (if any) is reported. null = nothing here. */
export type InlineMatch = { value: string | null; length: number } | null;
export type InlineMatcher = (text: string, at: number) => InlineMatch;

/** Line after the fenced block that starts at `at`, or -1 when the fence is never closed (then it is ordinary text). */
function fenceEnd(lines: readonly string[], at: number): number {
  const first = lines[at]!.replace(fenceRe, "");
  const oneLine = closeRe.exec(first);
  if (oneLine) return oneLine[1]!.trim() ? at + 1 : -1;
  for (let i = at + 1; i < lines.length; i++) if (closeRe.test(lines[i]!)) return i + 1;
  return -1;
}

function runLength(text: string, at: number): number {
  let n = 1;
  while (text[at + n] === text[at]) n++;
  return n;
}

/** Matches in one block of lines, outside code spans and not escaped. */
function scanInline(text: string, match: InlineMatcher, found: Set<string>): void {
  for (let i = 0; i < text.length;) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && escapableRe.test(text[i + 1]!)) { i += 2; continue; }
    if (c === "`") {
      const n = runLength(text, i);
      let close = -1;
      for (let j = i + n; j < text.length;) {
        if (text[j] !== "`") { j++; continue; }
        const run = runLength(text, j);
        if (run === n) { close = j; break; }
        j += run;
      }
      i = close < 0 ? i + n : close + n;
      continue;
    }
    const m = match(text, i);
    if (m && m.length > 0) { if (m.value !== null) found.add(m.value); i += m.length; continue; }
    i++;
  }
}

function scanBlocks(lines: readonly string[], depth: number, match: InlineMatcher, found: Set<string>): void {
  let block: string[] = [];
  // The parser reads a paragraph's lines together but list items and table rows line by line, and the scanner does not
  // know which it is: a match counts only when it is outside code both ways.
  const flush = () => {
    if (block.length === 1) scanInline(block[0]!, match, found);
    else if (block.length > 1) {
      const joined = new Set<string>(), single = new Set<string>();
      scanInline(block.join("\n"), match, joined);
      for (const line of block) scanInline(line, match, single);
      for (const value of joined) if (single.has(value)) found.add(value);
    }
    block = [];
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (fenceRe.test(line)) {
      const end = fenceEnd(lines, i);
      if (end > 0) { flush(); i = end; continue; }
    } else if (depth < MAX_QUOTE_DEPTH && quoteRe.test(line)) {
      flush();
      const inner: string[] = [];
      while (i < lines.length && quoteRe.test(lines[i]!)) { inner.push(quoteRe.exec(lines[i]!)![1] ?? ""); i++; }
      scanBlocks(inner, depth + 1, match, found);
      continue;
    }
    if (line.trim()) block.push(line); else flush();
    i++;
  }
  flush();
}

/** The distinct values `match` reports in a message text, in the order they appear, never from inside code or behind a backslash. */
export function scanOutsideCode(content: string, match: InlineMatcher): string[] {
  const found = new Set<string>();
  scanBlocks(content.replace(/\r\n?/g, "\n").split("\n"), 0, match, found);
  return [...found];
}
