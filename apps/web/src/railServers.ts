import type { AccountServer } from "@squorli/protocol";
import type { RailServer } from "./ServerRail";
import { sortByServerOrder } from "./serverOrder";

/**
 * Entries of the server rail, in order: the home server (when the client has one), the account's servers from the directory
 * (most recently seen first, without the home server), then the servers added by address that the account's list lacks
 * (client without a home server). Then the user's `order` (serverOrder.ts): the hosts it names come first in that order, the
 * rest keep the default order behind them. `keyOf` maps a directory host onto the store's key; icons come from the directory only.
 */
export function buildRailServers(o: {
  home: RailServer | null;
  accountServers: readonly AccountServer[];
  localHosts: readonly { host: string; name: string | null }[];
  keyOf: (host: string) => string;
  iconOf: (server: AccountServer) => string | null;
  subOf: (displayName: string) => string;
  order: readonly string[];
}): RailServer[] {
  const out: RailServer[] = o.home ? [o.home] : [];
  const seen = new Set(out.map((s) => s.key));
  for (const s of o.accountServers.slice().sort((a, b) => (b.lastSeenAt < a.lastSeenAt ? -1 : b.lastSeenAt > a.lastSeenAt ? 1 : 0))) {
    const key = o.keyOf(s.host);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, host: s.host, name: s.name ?? s.host, sub: s.displayName ? o.subOf(s.displayName) : null, iconUrl: o.iconOf(s) });
  }
  for (const l of o.localHosts) {
    const key = o.keyOf(l.host);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, host: l.host, name: l.name ?? l.host, sub: null, iconUrl: null });
  }
  return sortByServerOrder(out, o.order);
}
