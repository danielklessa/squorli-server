import type { EmojiEntry, EmojiGroup } from "./types";

/** Pure logic of the emoji picker (EmojiPicker.tsx): search, skin tone, recently used, inserting at the caret. */

/** 0 = the emoji's own (yellow) form, 1..5 = light .. dark. */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;
export const SKIN_TONES: readonly SkinTone[] = [0, 1, 2, 3, 4, 5];

export const emojiWithTone = (entry: EmojiEntry, tone: SkinTone): string => (tone > 0 ? entry[4]?.[tone - 1] : undefined) ?? entry[0];

/** The first shortcode is the one shown (GitHub's name where it has one). */
export const firstShortcode = (entry: EmojiEntry): string | null => entry[3].split(" ")[0] || null;

/**
 * Every word of the query must occur in the name, the keywords or the shortcodes (colons and case do not matter, so
 * ":smi" finds ":smile:"). First the hits whose name or shortcode is the query, then those starting with it, then the
 * rest; inside each part the emoji order stays.
 */
export function searchEmoji(groups: readonly EmojiGroup[], query: string, limit = 160): EmojiEntry[] {
  const terms = query.toLowerCase().replace(/:/g, " ").split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const first = terms[0]!;
  const exact: EmojiEntry[] = [], head: EmojiEntry[] = [], tail: EmojiEntry[] = [];
  for (const group of groups) for (const entry of group.emojis) {
    const name = entry[1].toLowerCase(), codes = entry[3].split(" ");
    const hay = `${name} ${entry[2]} ${entry[3]}`;
    if (!terms.every((term) => hay.includes(term))) continue;
    if (name === first || codes.includes(first)) exact.push(entry);
    else if (name.startsWith(first) || codes.some((c) => c.startsWith(first))) head.push(entry);
    else tail.push(entry);
  }
  return [...exact, ...head, ...tail].slice(0, limit);
}

/** Entries for stored characters (recently used); characters the data no longer knows are dropped. */
export function entriesOf(groups: readonly EmojiGroup[], chars: readonly string[]): EmojiEntry[] {
  const byChar = new Map<string, EmojiEntry>();
  for (const group of groups) for (const entry of group.emojis) {
    byChar.set(entry[0], entry);
    for (const skin of entry[4] ?? []) byChar.set(skin, [skin, entry[1], entry[2], entry[3]]);
  }
  return chars.map((c) => byChar.get(c)).filter((e): e is EmojiEntry => e !== undefined);   // no flatMap: an entry is an array itself
}

export const RECENT_MAX = 24;

/** Newest first, no duplicates. */
export function pushRecent(list: readonly string[], char: string, max = RECENT_MAX): string[] {
  return [char, ...list.filter((c) => c !== char)].slice(0, max);
}

/** Replaces the selection [start, end) by `insert`; `caret` is where typing continues. */
export function insertAt(value: string, start: number, end: number, insert: string): { value: string; caret: number } {
  const a = Math.max(0, Math.min(start, value.length)), b = Math.max(a, Math.min(end, value.length));
  return { value: value.slice(0, a) + insert + value.slice(b), caret: a + insert.length };
}

// Per device: what was used here and the preferred skin tone (not part of the directory account, see AGENTS.md section 1).
const RECENT_KEY = "chat.emoji.recent.v1";
const TONE_KEY = "chat.emoji.tone.v1";

export function loadRecent(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
export function saveRecent(list: readonly string[]): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage full or blocked: the list is a comfort only */ }
}
export function loadTone(): SkinTone {
  try { const n = Number(localStorage.getItem(TONE_KEY)); return SKIN_TONES.includes(n as SkinTone) ? (n as SkinTone) : 0; } catch { return 0; }
}
export function saveTone(tone: SkinTone): void {
  try { localStorage.setItem(TONE_KEY, String(tone)); } catch { /* see saveRecent */ }
}
