/**
 * The order of the server rail as the user arranged it (22 September 2026, user's wish: sort the server list by drag and drop
 * and keep that order through the directory account). The order is a list of directory hosts, first at the top; servers it does
 * not name follow in the rail's default order (railServers.ts). It is one of the account's settings (`VoiceSettings.serverOrder`,
 * protocol `AccountSettings.serverOrder`), so it follows the user to every client. Pure functions, no storage access.
 */
import { SERVER_ORDER_MAX } from "@squorli/protocol";

/** Longest host name a rail entry may have (DNS limit). */
const HOST_MAX = 253;

/** A stored or received order made valid: lower-case hosts, no repeats, no empty or overlong entries, at most `SERVER_ORDER_MAX`. */
export function normalizeServerOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const host = v.trim().toLowerCase();
    if (!host || host.length > HOST_MAX || out.includes(host)) continue;
    out.push(host);
    if (out.length >= SERVER_ORDER_MAX) break;
  }
  return out;
}

/** The entries the user placed come first in their order; everything else keeps its relative order behind them. */
export function sortByServerOrder<T extends { host: string }>(entries: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...entries];
  const rank = new Map(order.map((host, i) => [host.toLowerCase(), i] as const));
  const placed = entries.filter((e) => rank.has(e.host.toLowerCase())).sort((a, b) => rank.get(a.host.toLowerCase())! - rank.get(b.host.toLowerCase())!);
  const rest = entries.filter((e) => !rank.has(e.host.toLowerCase()));
  return [...placed, ...rest];
}

/**
 * The list with the entry at `from` taken out and put back in front of the entry that sat at `to` (`to` = length puts it last).
 * Returns the same array when nothing moves.
 */
export function moveInOrder(hosts: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= hosts.length || to < 0 || to > hosts.length || to === from || to === from + 1) return [...hosts];
  const out = [...hosts];
  const [moved] = out.splice(from, 1);
  out.splice(to > from ? to - 1 : to, 0, moved!);
  return out;
}

/** Same order? */
export function sameServerOrder(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((h, i) => h === b[i]);
}
