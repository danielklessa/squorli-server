import type { Member, Role } from "@squorli/protocol";

/**
 * The picker "add a role or member" of the channel dialog (docs/features/channel-permissions.md), the pure part: which
 * entries a query matches and in which order. Roles before members at the same rank, the default role never (its entry is
 * always there). `rankMatch` is the rule the mention list uses too (mentions.ts), so both rank the same way.
 */
export type PickerEntry = { kind: "role"; role: Role } | { kind: "user"; member: Member };

/** 0 = starts with the query (name or handle), 1 = a word of the name does, 2 = contained somewhere, -1 = no match. */
export function rankMatch(label: string, handle: string | null, query: string): number {
  const q = query.toLowerCase(), l = label.toLowerCase(), h = handle?.toLowerCase() ?? "";
  if (!q) return 0;
  if (l.startsWith(q) || h.startsWith(q)) return 0;
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  return l.includes(q) || h.includes(q) ? 2 : -1;
}

export function suggestEntities(roles: readonly Role[], members: readonly Member[], query: string, opts: { exclude?: ReadonlySet<string>; limit?: number } = {}): PickerEntry[] {
  const exclude = opts.exclude ?? new Set<string>(), limit = opts.limit ?? 12;
  const ranked: { e: PickerEntry; r: number; label: string; order: number }[] = [];
  for (const role of roles) {
    if (role.isDefault || exclude.has(`role:${role.id}`)) continue;
    const r = rankMatch(role.name, null, query);
    if (r >= 0) ranked.push({ e: { kind: "role", role }, r, label: role.name, order: 0 });
  }
  for (const member of members) {
    if (exclude.has(`member:${member.userId}`)) continue;
    const r = rankMatch(member.displayName, member.handle, query);
    if (r >= 0) ranked.push({ e: { kind: "user", member }, r, label: member.displayName, order: 1 });
  }
  return ranked.sort((a, b) => a.r - b.r || a.order - b.order || a.label.localeCompare(b.label)).slice(0, limit).map((x) => x.e);
}

export const entryKey = (e: PickerEntry) => (e.kind === "role" ? `role:${e.role.id}` : `member:${e.member.userId}`);
