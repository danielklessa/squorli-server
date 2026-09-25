import { mentionToken, mentionedUserIds } from "@squorli/protocol";
import { rankMatch } from "./pickerEntries";
import { parseMarkdown, type Block, type Inline } from "./markdown";

/**
 * Mentions in the channel chat, pure logic. A message stores a mention as `<@userId>` (the id never changes, names do;
 * the server treats it as plain text, there is no protocol change). The composer shows and takes `@Name`:
 * `encodeMentions` turns names into tokens when sending, `decodeMentions` back when a message is edited. The Markdown
 * parser makes a `mention` node of every token outside code. "Am I mentioned" must hold for the parser (what the view
 * shows) and for the protocol's `mentionedUserIds` (what the server counts), so a mark never appears without a visible
 * mention and the live counter agrees with the server's. No false alarms when writing either: a typed name only becomes
 * a mention when exactly one member carries it; with equal names only the one chosen in the suggestion list.
 */
export type Mentionable = { userId: string; displayName: string; handle: string | null; localHandle?: string | null };
/** The handle a member is found by: the directory's, else the server account's (`~name`, docs/features/local-accounts.md). */
const findHandle = (m: Mentionable) => m.handle ?? m.localHandle ?? null;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const tokenRe = new RegExp(`<@(${UUID})>`, "g");
// Code spans and fenced blocks: what is written there stays literal in both directions.
const codeRe = /(```[\s\S]*?```|`[^`\n]+`)/;
const wordRe = /[\p{L}\p{N}_]/u;

export { mentionToken };

/** How a member is written after the "@": the display name; a name that is itself "@handle" or "~handle" loses that prefix. */
export const mentionLabel = (m: Mentionable) => m.displayName.replace(/^[@~]+/, "");

/** Chosen in the suggestion list: label -> userId, decides when two members carry the same name. */
export type Picked = Map<string, string>;

/**
 * `@Name` and `@handle` -> `<@userId>`, longest name first so "@Max Mustermann" does not end at "@Max". A name or handle
 * that belongs to several members stays text (userId null) unless one of them was chosen; it still takes its place in the
 * text, so the ambiguous "@Max Mustermann" does not fall back to "@Max".
 */
export function encodeMentions(text: string, members: readonly Mentionable[], picked: Picked = new Map()): string {
  if (!text.includes("@")) return text;
  const chosen = new Map<string, string>(), owners = new Map<string, Set<string>>();
  for (const [label, userId] of picked) if (label && members.some((m) => m.userId === userId)) chosen.set(label.toLowerCase(), userId);
  const own = (label: string, userId: string) => { const key = label.toLowerCase(); if (key) owners.set(key, (owners.get(key) ?? new Set()).add(userId)); };
  for (const m of members) { own(mentionLabel(m), m.userId); const h = findHandle(m); if (h) own(h, m.userId); }
  const names: { key: string; userId: string | null }[] = [...new Set([...chosen.keys(), ...owners.keys()])]
    .map((key) => ({ key, userId: chosen.get(key) ?? (owners.get(key)!.size === 1 ? [...owners.get(key)!][0]! : null) }));
  names.sort((a, b) => b.key.length - a.key.length);

  return text.split(codeRe).map((part, i) => {
    if (i % 2 === 1) return part;
    let out = "";
    for (let at = 0; at < part.length;) {
      const c = part[at]!;
      if (c === "@" && !(at > 0 && wordRe.test(part[at - 1]!))) {
        const rest = part.slice(at + 1).toLowerCase();
        const hit = names.find((n) => rest.startsWith(n.key) && !wordRe.test(part[at + 1 + n.key.length] ?? " "));
        if (hit) { out += hit.userId ? mentionToken(hit.userId) : part.slice(at, at + 1 + hit.key.length); at += 1 + hit.key.length; continue; }
      }
      out += c; at++;
    }
    return out;
  }).join("");
}

/** `<@userId>` -> `@Name` for the edit field; tokens of people who left stay as they are. */
export function decodeMentions(content: string, members: readonly Mentionable[]): { text: string; picked: Picked } {
  const picked: Picked = new Map();
  const text = content.split(codeRe).map((part, i) => (i % 2 === 1 ? part : part.replace(tokenRe, (token, userId: string) => {
    const member = members.find((m) => m.userId === userId);
    if (!member) return token;
    const label = mentionLabel(member);
    // Two mentioned members with the same name: the text could not tell them apart, the second one stays a token.
    if ((picked.get(label) ?? userId) !== userId) return token;
    picked.set(label, userId);
    return `@${label}`;
  }))).join("");
  return { text, picked };
}

function walk(nodes: readonly Inline[], found: Set<string>): void {
  for (const n of nodes) {
    if (n.type === "mention") found.add(n.userId);
    else if ("children" in n) walk(n.children, found);
  }
}
function walkBlocks(blocks: readonly Block[], found: Set<string>): void {
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "heading") walk(b.children, found);
    else if (b.type === "quote") walkBlocks(b.children, found);
    else if (b.type === "table") { for (const cell of b.head) walk(cell, found); for (const row of b.rows) for (const cell of row) walk(cell, found); }
    else if (b.type === "list") {
      const items = [...b.items];
      for (let item = items.shift(); item; item = items.shift()) { walk(item.children, found); if (item.sub) items.push(...item.sub.items); }
    }
  }
}

/** The people a message mentions (as the message view shows it: not inside code). */
export function mentionedIds(content: string): Set<string> {
  const found = new Set<string>();
  if (content.includes("<@")) walkBlocks(parseMarkdown(content), found);
  return found;
}
export const mentionsUser = (content: string, userId: string): boolean =>
  content.includes(mentionToken(userId)) && mentionedUserIds(content).includes(userId) && mentionedIds(content).has(userId);

/** The "@query" being typed right before the caret; `start` is the position of the "@". */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|[\s(])@([^\s@]{0,32})$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[1]!.length - 1, query: m[1]! } : null;
}

/** Members for a query: names or handles starting with it first, then those containing it; alphabetical inside both (the rule is rankMatch of entityPicker.ts, shared with the channel dialog's picker). */
export function suggestMembers<T extends Mentionable>(members: readonly T[], query: string, limit = 8): T[] {
  const rank = (m: T) => rankMatch(mentionLabel(m), findHandle(m), query);
  return members.map((m) => ({ m, r: rank(m) })).filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || mentionLabel(a.m).localeCompare(mentionLabel(b.m))).slice(0, limit).map((x) => x.m);
}
