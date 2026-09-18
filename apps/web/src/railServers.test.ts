import type { AccountServer } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { buildRailServers } from "./railServers";

const srv = (host: string, lastSeenAt: string, displayName: string | null = null): AccountServer =>
  ({ host, name: `Name of ${host}`, displayName, lastSeenAt, verified: true, iconUpdatedAt: null, leaveRequestedAt: null });
const base = { keyOf: (h: string) => h.toLowerCase(), iconOf: (s: AccountServer) => `icon:${s.host}`, subOf: (n: string) => `as ${n}` };

describe("buildRailServers", () => {
  it("puts the home server first and does not repeat it", () => {
    const home = { key: "localhost:5173", host: "home.example", name: "Home", sub: null, iconUrl: null };
    const list = buildRailServers({ ...base, home, accountServers: [srv("home.example", "2026-09-10T00:00:00.000Z"), srv("b.example", "2026-09-01T00:00:00.000Z")], localHosts: [], keyOf: (h) => (h === "home.example" ? "localhost:5173" : h) });
    expect(list.map((s) => s.key)).toEqual(["localhost:5173", "b.example"]);
  });

  it("orders the account's servers by when they were seen last and names the display name", () => {
    const list = buildRailServers({ ...base, home: null, accountServers: [srv("old.example", "2026-09-01T00:00:00.000Z"), srv("new.example", "2026-09-10T00:00:00.000Z", "Dana")], localHosts: [] });
    expect(list).toEqual([
      { key: "new.example", host: "new.example", name: "Name of new.example", sub: "as Dana", iconUrl: "icon:new.example" },
      { key: "old.example", host: "old.example", name: "Name of old.example", sub: null, iconUrl: "icon:old.example" },
    ]);
  });

  it("appends added servers the account's list lacks, without an icon", () => {
    const list = buildRailServers({ ...base, home: null, accountServers: [srv("a.example", "2026-09-01T00:00:00.000Z")], localHosts: [{ host: "a.example", name: "A" }, { host: "local.example", name: null }, { host: "named.example", name: "Named" }] });
    expect(list.map((s) => [s.key, s.name, s.iconUrl])).toEqual([["a.example", "Name of a.example", "icon:a.example"], ["local.example", "local.example", null], ["named.example", "Named", null]]);
  });
});
