import { describe, expect, it } from "vitest";
import { AfkMover, type AfkMoveInput } from "./afk";

const input = (p: Partial<AfkMoveInput> & { channels?: Record<string, string> }): AfkMoveInput => ({
  afkChannelId: "afk", afk: [], exemptChannels: new Set(),
  channelOf: (userId) => p.channels?.[userId], ...p,
});

describe("AfkMover", () => {
  it("moves an absent member of a voice channel", () => {
    const m = new AfkMover();
    expect(m.due(input({ afk: [], channels: { u1: "lobby" } }))).toEqual([]);
    expect(m.due(input({ afk: ["u1"], channels: { u1: "lobby" } }))).toEqual([{ userId: "u1", from: "lobby" }]);
  });

  it("moves nobody without an AFK channel, outside voice, inside the AFK channel or out of a channel showing a video", () => {
    const afk = ["u1", "u2", "u3"];
    const channels = { u2: "afk", u3: "cinema" };
    expect(new AfkMover().due(input({ afk, channels, exemptChannels: new Set(["cinema"]) }))).toEqual([]);
    expect(new AfkMover().due(input({ afkChannelId: null, afk, channels: { u1: "lobby" } }))).toEqual([]);
  });

  it("moves a member once the video in their channel has ended", () => {
    const m = new AfkMover();
    expect(m.due(input({ afk: ["u1"], channels: { u1: "cinema" }, exemptChannels: new Set(["cinema"]) }))).toEqual([]);
    expect(m.due(input({ afk: ["u1"], channels: { u1: "cinema" } }))).toEqual([{ userId: "u1", from: "cinema" }]);
  });

  it("moves at most once per absence", () => {
    const m = new AfkMover();
    expect(m.due(input({ afk: ["u1"], channels: { u1: "lobby" } }))).toHaveLength(1);
    expect(m.due(input({ afk: ["u1"], channels: { u1: "lobby" } }))).toEqual([]);
    expect(m.due(input({ afk: [], channels: { u1: "lobby" } }))).toEqual([]); // back
    expect(m.due(input({ afk: ["u1"], channels: { u1: "lobby" } }))).toHaveLength(1); // absent again
  });
});
