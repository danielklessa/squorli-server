import { describe, expect, it, vi } from "vitest";
import { VoicePresence } from "./presence";

const a = { userId: "11111111-1111-4111-8111-111111111111", displayName: "A", micMuted: false, deafened: false, cameraOn: false, screenOn: false };
const b = { userId: "22222222-2222-4222-8222-222222222222", displayName: "B", micMuted: false, deafened: false, cameraOn: false, screenOn: false };

describe("VoicePresence", () => {
  it("lists members per channel and removes them on leave", () => {
    const p = new VoicePresence<string>();
    p.join("c1", "lobby", a);
    p.join("c2", "lobby", b);
    expect(p.members("lobby").map((m) => m.displayName)).toEqual(["A", "B"]);
    p.leave("c1");
    expect(p.members("lobby")).toEqual([b]);
    p.leave("c1"); // doing it twice is harmless
    expect(p.channelOf("c2")).toBe("lobby");
  });

  it("names the user's other connections in voice, never the one that asks", () => {
    const p = new VoicePresence<string>();
    p.join("phone", "lobby", a);
    p.join("tabB", "lobby", b);
    p.join("guess", "other", a, true);
    expect(p.othersOfUser(a.userId, "desktop")).toEqual([{ conn: "phone", channelId: "lobby" }, { conn: "guess", channelId: "other" }]);
    expect(p.othersOfUser(a.userId, "phone")).toEqual([{ conn: "guess", channelId: "other" }]);
    expect(p.othersOfUser(b.userId, "tabB")).toEqual([]);
  });

  it("an entry restored from LiveKit gives way once the user's client speaks for itself", () => {
    const p = new VoicePresence<string>();
    p.join("tab1", "lobby", a, true);
    expect(p.restoredEntries()).toEqual([{ conn: "tab1", channelId: "lobby", userId: a.userId }]);
    // The other tab is the one in voice and leaves: nothing of the user may stay behind.
    p.dropRestored(a.userId, "tab2");
    p.leave("tab2");
    expect(p.members("lobby")).toEqual([]);
    // The connection itself says where it is: an ordinary entry from then on.
    p.join("tab1", "lobby", a, true);
    p.dropRestored(a.userId, "tab1");
    p.join("tab1", "lobby", a);
    expect(p.restoredEntries()).toEqual([]);
    expect(p.members("lobby")).toEqual([a]);
  });

  it("counts a user with two connections once", () => {
    const p = new VoicePresence<string>();
    p.join("tab1", "lobby", a);
    p.join("tab2", "lobby", a);
    expect(p.members("lobby")).toHaveLength(1);
    p.leave("tab1");
    expect(p.members("lobby")).toHaveLength(1);
    p.leave("tab2");
    expect(p.members("lobby")).toHaveLength(0);
  });

  it("notifies old and new channel on switch", () => {
    const p = new VoicePresence<string>();
    const fn = vi.fn();
    p.onChange(fn);
    p.join("c1", "lobby", a);
    p.join("c1", "other", a);
    const channels = fn.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(["lobby", "lobby", "other"]);
    expect(p.members("lobby")).toEqual([]);
    expect(p.members("other")).toEqual([a]);
  });

  it("renames across connections", () => {
    const p = new VoicePresence<string>();
    p.join("c1", "lobby", { ...a, micMuted: true });
    p.rename(a.userId, { displayName: null, publicKey: "abcdef1234" });
    expect(p.members("lobby")[0]).toEqual({ ...a, displayName: "anon-abcdef", micMuted: true });
  });

  it("carries the mute state a client reports and tells the channel about a change only", () => {
    const p = new VoicePresence<string>();
    const fn = vi.fn();
    p.onChange(fn);
    const off = { cameraOn: false, screenOn: false };
    p.setStatus("c1", { micMuted: true, deafened: false, ...off }); // in no channel: nothing
    p.join("c1", "lobby", { ...a, micMuted: true });
    p.setStatus("c1", { micMuted: true, deafened: false, ...off }); // no change: no event
    expect(fn).toHaveBeenCalledTimes(1);
    p.setStatus("c1", { micMuted: true, deafened: true, ...off });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(p.members("lobby")).toEqual([{ ...a, micMuted: true, deafened: true }]);
    expect(p.statusOfUser(a.userId)).toEqual({ channelId: "lobby", micMuted: true, deafened: true, ...off });
    // Camera and screen share travel the same way.
    p.setStatus("c1", { micMuted: true, deafened: true, cameraOn: true, screenOn: true });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(p.statusOfUser(a.userId)).toEqual({ channelId: "lobby", micMuted: true, deafened: true, cameraOn: true, screenOn: true });
    expect(p.statusOfUser(b.userId)).toBeUndefined();
    // A restored entry (LiveKit's guess) says nothing about the mute state and starts unmuted.
    p.join("c2", "lobby", b, true);
    expect(p.members("lobby")[1]).toEqual(b);
  });
});
