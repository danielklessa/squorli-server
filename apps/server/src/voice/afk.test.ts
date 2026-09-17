import { describe, expect, it } from "vitest";
import { AfkMover, type AfkMoveInput } from "./afk";

const MIN = 60_000;
const input = (p: Partial<AfkMoveInput> & { channels?: Record<string, string> }): AfkMoveInput => ({
  afkChannelId: "afk", moveAfterMs: 5 * MIN, now: 100 * MIN, afk: [], exemptChannels: new Set(),
  channelOf: (userId) => p.channels?.[userId], ...p,
});

describe("AfkMover", () => {
  it("moves an absent member of a voice channel once the time is up", () => {
    const m = new AfkMover();
    expect(m.due(input({ afk: [["u1", 96 * MIN]], channels: { u1: "lobby" } }))).toEqual([]);
    expect(m.due(input({ afk: [["u1", 95 * MIN]], channels: { u1: "lobby" } }))).toEqual([{ userId: "u1", from: "lobby" }]);
  });

  it("waits for the admin's time, not only for the AFK status", () => {
    const m = new AfkMover();
    expect(m.due(input({ moveAfterMs: 30 * MIN, afk: [["u1", 80 * MIN]], channels: { u1: "lobby" } }))).toEqual([]);
    expect(m.due(input({ moveAfterMs: 30 * MIN, afk: [["u1", 70 * MIN]], channels: { u1: "lobby" } }))).toHaveLength(1);
  });

  it("moves nobody without an AFK channel, outside voice, inside the AFK channel or out of a channel showing a video", () => {
    const afk: [string, number][] = [["u1", 0], ["u2", 0], ["u3", 0]];
    const channels = { u2: "afk", u3: "cinema" };
    expect(new AfkMover().due(input({ afk, channels, exemptChannels: new Set(["cinema"]) }))).toEqual([]);
    expect(new AfkMover().due(input({ afkChannelId: null, afk, channels: { u1: "lobby" } }))).toEqual([]);
  });

  it("moves a member once the video in their channel has ended", () => {
    const m = new AfkMover();
    const afk: [string, number][] = [["u1", 0]];
    expect(m.due(input({ afk, channels: { u1: "cinema" }, exemptChannels: new Set(["cinema"]) }))).toEqual([]);
    expect(m.due(input({ afk, channels: { u1: "cinema" } }))).toEqual([{ userId: "u1", from: "cinema" }]);
  });

  it("moves at most once per absence", () => {
    const m = new AfkMover();
    const afk: [string, number][] = [["u1", 0]];
    expect(m.due(input({ afk, channels: { u1: "lobby" } }))).toHaveLength(1);
    expect(m.due(input({ afk, channels: { u1: "lobby" } }))).toEqual([]);
    expect(m.due(input({ afk: [], channels: { u1: "lobby" } }))).toEqual([]); // back
    expect(m.due(input({ afk, channels: { u1: "lobby" } }))).toHaveLength(1); // absent again
  });
});
