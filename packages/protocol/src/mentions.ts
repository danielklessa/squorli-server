/**
 * Who a message mentions, for counting. A mention is stored as `<@userId>` in the message text; the web client's Markdown
 * parser (apps/web/src/markdown.ts) shows it as a mention everywhere except in code and behind a backslash. The server
 * counts unread mentions (GET /api/read-state) and has no Markdown parser, so it reads the text with the small scanner of
 * scan.ts, which follows the parser's rules for exactly those cases. The web tests compare it with the parser.
 */
import { scanOutsideCode } from "./scan";

const tokenRe = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/y;

export const mentionToken = (userId: string) => `<@${userId}>`;

/** The user ids a message text mentions (not inside code, not escaped). */
export function mentionedUserIds(content: string): string[] {
  if (!content.includes("<@")) return [];
  return scanOutsideCode(content, (text, at) => {
    if (text[at] !== "<" || text[at + 1] !== "@") return null;
    tokenRe.lastIndex = at;
    const m = tokenRe.exec(text);
    return m ? { value: m[1]!, length: m[0].length } : null;
  });
}
