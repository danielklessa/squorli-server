/**
 * Who a message mentions, for counting. A mention is stored as `<@userId>` in the message text; the web client's Markdown
 * parser (apps/web/src/markdown.ts) shows it as a mention everywhere except in code and behind a backslash. The server
 * counts unread mentions (GET /api/read-state) and has no Markdown parser, so this small scanner follows the same rules for
 * exactly those cases: fenced code (also inside quotes, an unclosed fence is no code), code spans (a run of n backticks
 * closes with a run of n, inside one block of lines) and `\<`. The web tests compare it with the parser. Where the two
 * could still differ (a span broken across list items), the scanner says "not mentioned": no false alarms.
 */
const MAX_QUOTE_DEPTH = 6;   // as in the parser: deeper ">" levels stay plain text
const quoteRe = /^ {0,3}>(?: (.*)|[ \t]*)$/;
const fenceRe = /^ {0,3}```/;
const closeRe = /^(.*?)```[ \t]*$/;
const escapableRe = /[!-/:-@[-`{-~]/;
const tokenRe = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/y;

export const mentionToken = (userId: string) => `<@${userId}>`;

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

/** Tokens in one block of lines, outside code spans and not escaped. */
function scanInline(text: string, found: Set<string>): void {
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
    if (c === "<" && text[i + 1] === "@") {
      tokenRe.lastIndex = i;
      const m = tokenRe.exec(text);
      if (m) { found.add(m[1]!); i += m[0].length; continue; }
    }
    i++;
  }
}

function scanBlocks(lines: readonly string[], depth: number, found: Set<string>): void {
  let block: string[] = [];
  // The parser reads a paragraph's lines together but list items and table rows line by line, and the scanner does not
  // know which it is: a token counts only when it is outside code both ways.
  const flush = () => {
    if (block.length === 1) scanInline(block[0]!, found);
    else if (block.length > 1) {
      const joined = new Set<string>(), single = new Set<string>();
      scanInline(block.join("\n"), joined);
      for (const line of block) scanInline(line, single);
      for (const id of joined) if (single.has(id)) found.add(id);
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
      scanBlocks(inner, depth + 1, found);
      continue;
    }
    if (line.trim()) block.push(line); else flush();
    i++;
  }
  flush();
}

/** The user ids a message text mentions (not inside code, not escaped). */
export function mentionedUserIds(content: string): string[] {
  if (!content.includes("<@")) return [];
  const found = new Set<string>();
  scanBlocks(content.replace(/\r\n?/g, "\n").split("\n"), 0, found);
  return [...found];
}
