import { describe, expect, it } from "vitest";
import { RETRY_LOCK_MS, reachableServers, retryLocked, secondsUntil } from "./otherServers";
import type { ServerConnState } from "./serverConnection";

const conn = (host: string, connection: ServerConnState["connection"], name: string | null): ServerConnState =>
  ({ host, connection, serverName: name, server: connection === "connected" ? { settings: { name: name ?? host } } : null } as unknown as ServerConnState);

describe("reachableServers", () => {
  it("offers the connected servers by name, never the one on screen, at most five", () => {
    const servers = {
      down: conn("down.example", "error", "Down"),
      b: conn("b.example", "connected", "Bravo"),
      a: conn("a.example", "connected", "Alpha"),
      c: conn("c.example", "connecting", "Charlie"),
      ...Object.fromEntries(["d", "e", "f", "g", "h"].map((k) => [k, conn(`${k}.example`, "connected", k.toUpperCase())])),
    };
    const out = reachableServers(servers, "down", (key) => (key === "a" ? "https://dir/icon/a" : null));
    expect(out).toHaveLength(5);
    expect(out.map((s) => s.name)).toEqual(["Alpha", "Bravo", "D", "E", "F"]);
    expect(out.map((s) => s.iconUrl)).toEqual(["https://dir/icon/a", null, null, null, null]);
    expect(out.some((s) => s.key === "down" || s.key === "c")).toBe(false);
    expect(reachableServers({ down: servers.down }, "down")).toEqual([]);
  });
});

describe("retryLocked", () => {
  it("rests for five seconds after a try started, and as long as that try runs", () => {
    expect(retryLocked(null, 10_000, false)).toBe(false);
    expect(retryLocked(10_000, 10_000, false)).toBe(true);
    expect(retryLocked(10_000, 10_000 + RETRY_LOCK_MS - 1, false)).toBe(true);
    expect(retryLocked(10_000, 10_000 + RETRY_LOCK_MS, false)).toBe(false);
    expect(retryLocked(10_000, 10_000 + RETRY_LOCK_MS, true)).toBe(true); // 5 s over, the try still under way
    expect(retryLocked(null, 10_000, true)).toBe(true);
  });
});

describe("secondsUntil", () => {
  it("counts whole seconds down to zero", () => {
    expect(secondsUntil(null, 1000)).toBeNull();
    expect(secondsUntil(5000, 1000)).toBe(4);
    expect(secondsUntil(4100, 1000)).toBe(4); // rounded up: "in 4 s" until it is 3
    expect(secondsUntil(900, 1000)).toBe(0);
  });
});
