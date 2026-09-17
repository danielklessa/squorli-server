import { AFK_AFTER_MS } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { Hub } from "./hub";

const sock = () => ({ readyState: 1, OPEN: 1, send() {}, close() {} }) as unknown as WebSocket;

describe("Hub AFK state", () => {
  it("is AFK only while every connection of the user is idle", () => {
    const hub = new Hub();
    const a = sock(), b = sock();
    hub.add("u1", a, "s1"); hub.add("u1", b, "s2");
    hub.setIdle(a, true, 1_000_000);
    expect(hub.isAfk("u1")).toBe(false);
    hub.setIdle(b, true, 1_060_000);
    expect(hub.isAfk("u1")).toBe(true);
    // Last activity = the connection that went idle last.
    expect(hub.afkUsers()).toEqual([["u1", 1_060_000 - AFK_AFTER_MS]]);
    hub.setIdle(a, false);
    expect(hub.isAfk("u1")).toBe(false);
  });

  it("tells the presence listeners about every change, once", () => {
    const hub = new Hub();
    const events: string[] = [];
    hub.onPresence((userId, online) => events.push(`${userId}:${online}`));
    const a = sock();
    hub.add("u1", a, "s1");
    hub.setIdle(a, true); hub.setIdle(a, true);
    hub.setIdle(a, false);
    expect(events).toEqual(["u1:true", "u1:true", "u1:true"]);
  });

  it("counts a new connection as active and forgets the state when the user goes offline", () => {
    const hub = new Hub();
    const a = sock(), b = sock();
    hub.add("u1", a, "s1");
    hub.setIdle(a, true);
    hub.add("u1", b, "s2");
    expect(hub.isAfk("u1")).toBe(false);
    // The connection in use closes, the idle one remains: absent from that moment on.
    hub.remove(b, 5_000_000);
    expect(hub.afkUsers()).toEqual([["u1", 5_000_000]]);
    hub.remove(a);
    expect(hub.isAfk("u1")).toBe(false);
    expect(hub.isOnline("u1")).toBe(false);
  });
});
