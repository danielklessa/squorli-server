import { describe, expect, it, vi } from "vitest";
import { VoicePresence } from "./presence";

const a = { userId: "11111111-1111-4111-8111-111111111111", displayName: "A" };
const b = { userId: "22222222-2222-4222-8222-222222222222", displayName: "B" };

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
    p.join("c1", "lobby", a);
    p.rename(a.userId, { displayName: null, publicKey: "abcdef1234" });
    expect(p.members("lobby")[0]?.displayName).toBe("anon-abcdef");
  });
});
