import { describe, expect, it } from "vitest";
import type { VoteKick } from "@squorli/protocol";
import type { Member, Role } from "@squorli/protocol";
import { blockMinutes, outcomeKey, secondsLeft, voiceChannelOf, voteBar, voteCounts, voteKickChannel, voteKickPerson } from "./voteKick";

const voice = { lobby: [{ userId: "a" }, { userId: "b" }, { userId: "t" }], second: [{ userId: "x" }] };
const allowed = { lobby: true, second: false };

describe("voteKickChannel", () => {
  it("offers the vote in the channel both sit in", () => {
    expect(voteKickChannel({ voice, voteKickAllowed: allowed, myUserId: "a", targetId: "t" })).toBe("lobby");
  });
  it("offers nothing about myself, about somebody elsewhere, or from outside a channel", () => {
    expect(voteKickChannel({ voice, voteKickAllowed: allowed, myUserId: "a", targetId: "a" })).toBeNull();
    expect(voteKickChannel({ voice, voteKickAllowed: allowed, myUserId: "a", targetId: "x" })).toBeNull();
    expect(voteKickChannel({ voice, voteKickAllowed: allowed, myUserId: "x", targetId: "a" })).toBeNull();
  });
  it("offers nothing where the server does not allow it (a moderator is there, too few, a vote is running, switched off)", () => {
    expect(voteKickChannel({ voice, voteKickAllowed: { lobby: false }, myUserId: "a", targetId: "t" })).toBeNull();
  });
  it("finds the seat of a member", () => {
    expect(voiceChannelOf(voice, "b")).toBe("lobby");
    expect(voiceChannelOf(voice, "nobody")).toBeNull();
  });
});

const vote = (yes: number, no: number, roomSize: number): VoteKick => ({
  id: "v", channelId: "lobby", targetId: "t", targetName: "T", startedBy: "a", startedByName: "A",
  startedAt: new Date(0).toISOString(), endsAt: new Date(60_000).toISOString(), yes, no, voters: roomSize - 1, roomSize,
});

describe("voteCounts", () => {
  it("says how many votes are still missing for the vote to count", () => {
    expect(voteCounts(vote(1, 0, 3))).toEqual({ yes: 1, no: 0, cast: 1, quorum: 2, missing: 1 });
    expect(voteCounts(vote(1, 1, 3))).toEqual({ yes: 1, no: 1, cast: 2, quorum: 2, missing: 0 });
    expect(voteCounts(vote(3, 1, 5))).toEqual({ yes: 3, no: 1, cast: 4, quorum: 3, missing: 0 });
  });
});

describe("the countdown and the block", () => {
  it("counts whole seconds down to zero", () => {
    expect(secondsLeft(new Date(60_000).toISOString(), 0)).toBe(60);
    expect(secondsLeft(new Date(60_000).toISOString(), 59_500)).toBe(1);
    expect(secondsLeft(new Date(60_000).toISOString(), 90_000)).toBe(0);
  });
  it("rounds the block up to whole minutes and says nothing without one", () => {
    expect(blockMinutes(new Date(15 * 60_000).toISOString(), 0)).toBe(15);
    expect(blockMinutes(new Date(30_000).toISOString(), 0)).toBe(1);
    expect(blockMinutes(null, 0)).toBe(0);
  });
  it("names the catalog key of every outcome", () => {
    expect(outcomeKey("passed")).toBe("votekick.res.passed");
    expect(outcomeKey("quorum")).toBe("votekick.res.quorum");
  });
});

describe("voteBar", () => {
  it("measures yes and no against everybody who sat in the channel, and marks the quorum", () => {
    expect(voteBar({ yes: 1, no: 0, roomSize: 3 })).toEqual({ yes: 33.3, no: 0, quorum: 66.7 });
    expect(voteBar({ yes: 2, no: 1, roomSize: 4 })).toEqual({ yes: 50, no: 25, quorum: 50 });
    // Nothing voted yet: an empty bar with the mark where it would start counting.
    expect(voteBar({ yes: 0, no: 0, roomSize: 5 })).toEqual({ yes: 0, no: 0, quorum: 60 });
  });
});

describe("voteKickPerson", () => {
  const roles = [
    { id: "r1", name: "Mitglied", color: "#3498db", permissions: 0, position: 1, isDefault: false },
    { id: "r2", name: "Mod", color: "#ff0000", permissions: 0, position: 5, isDefault: false },
  ] as Role[];
  const member = { userId: "u1", displayName: "Max", publicKey: "k", roleIds: ["r1", "r2"], joinedAt: "", online: true, afk: true, game: null, streamBlocked: false, handle: null, avatarUrl: "https://x/a.png", isOwner: false } as Member;

  it("takes name, avatar, presence and the colour of the highest role from the member list", () => {
    expect(voteKickPerson({ userId: "u1", fallbackName: "?", members: [member], roles })).toEqual({ displayName: "Max", avatarUrl: "https://x/a.png", color: "#ff0000", online: true, afk: true });
  });
  it("keeps the name of the vote for somebody who is no longer a member", () => {
    expect(voteKickPerson({ userId: "gone", fallbackName: "Weg", members: [member], roles })).toEqual({ displayName: "Weg", avatarUrl: null, color: null, online: false, afk: false });
  });
});
