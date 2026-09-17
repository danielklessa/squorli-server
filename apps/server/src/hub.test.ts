import { AFK_AFTER_MS } from "@squorli/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { Hub } from "./hub";

const sock = () => ({ readyState: 1, OPEN: 1, send() {}, close() {} }) as unknown as WebSocket;

describe("Hub AFK state", () => {
  afterEach(() => vi.useRealTimers());

  it("is AFK only while every connection of the user is idle", () => {
    const hub = new Hub();
    const a = sock(), b = sock();
    hub.add("u1", a, "s1"); hub.add("u1", b, "s2");
    hub.setIdle(a, true);
    expect(hub.isAfk("u1")).toBe(false);
    hub.setIdle(b, true);
    expect(hub.isAfk("u1")).toBe(true);
    expect(hub.afkUsers()).toEqual(["u1"]);
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
    hub.remove(b); hub.remove(a);
    expect(hub.isAfk("u1")).toBe(false);
    expect(hub.isOnline("u1")).toBe(false);
  });

  it("waits the full time after the connection in use has closed", () => {
    vi.useFakeTimers();
    const hub = new Hub();
    const events: string[] = [];
    const a = sock(), b = sock();
    hub.add("u1", a, "s1"); hub.add("u1", b, "s2");
    hub.setIdle(a, true);
    hub.onPresence((userId) => events.push(userId));
    // The user was active in b until it closed: the idle connection that remains does not make them absent right away.
    hub.remove(b);
    expect(hub.isAfk("u1")).toBe(false);
    vi.advanceTimersByTime(AFK_AFTER_MS - 1000);
    expect(hub.isAfk("u1")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(hub.isAfk("u1")).toBe(true);
    expect(events).toEqual(["u1"]);
  });

  it("activity during that time keeps the user present", () => {
    vi.useFakeTimers();
    const hub = new Hub();
    const a = sock(), b = sock();
    hub.add("u1", a, "s1"); hub.add("u1", b, "s2");
    hub.setIdle(a, true);
    hub.remove(b);
    hub.setIdle(a, false);
    vi.advanceTimersByTime(AFK_AFTER_MS);
    expect(hub.isAfk("u1")).toBe(false);
  });
});
