import { Permission, VOTEKICK_COOLDOWN_MS, VOTEKICK_MS } from "@squorli/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoteKicks, isVoiceModerator, outcomeOf, tally, voteKickOffered, voteOnWire, type EndReason, type RunningVote } from "./votekick";

const members = (...ids: string[]) => ids;

describe("voteKickOffered", () => {
  const base = { allowVoteKick: true, memberIds: members("a", "b", "c"), running: false, moderator: () => false };
  it("needs three members, the channel's permission and no vote already running", () => {
    expect(voteKickOffered(base)).toBe(true);
    expect(voteKickOffered({ ...base, memberIds: members("a", "b") })).toBe(false);
    expect(voteKickOffered({ ...base, allowVoteKick: false })).toBe(false);
    expect(voteKickOffered({ ...base, running: true })).toBe(false);
  });
  it("is off as soon as one of them could throw somebody out (the user's rule)", () => {
    expect(voteKickOffered({ ...base, moderator: (id) => id === "c" })).toBe(false);
  });
});

describe("isVoiceModerator", () => {
  it("counts MOVE_MEMBERS in the channel and KICK_MEMBERS server-wide", () => {
    expect(isVoiceModerator(Permission.MOVE_MEMBERS, 0)).toBe(true);
    expect(isVoiceModerator(0, Permission.KICK_MEMBERS)).toBe(true);
    expect(isVoiceModerator(0, Permission.ADMINISTRATOR)).toBe(true);
    expect(isVoiceModerator(Permission.CONNECT_VOICE | Permission.MODERATE_VOICE, Permission.SEND_MESSAGES)).toBe(false);
  });
});

describe("VoteKicks", () => {
  let store: VoteKicks;
  let ended: { vote: RunningVote; reason: EndReason }[];
  const start = () => store.start({ channelId: "chan", targetId: "t", targetName: "T", startedBy: "a", startedByName: "A", memberIds: members("a", "b", "t") }, (vote, reason) => { ended.push({ vote, reason }); });

  beforeEach(() => { vi.useFakeTimers(); store = new VoteKicks(); ended = []; });
  afterEach(() => { vi.useRealTimers(); });

  it("counts the starter as a yes and leaves the member it is about out of the electorate", () => {
    const vote = start();
    expect([...vote.electorate].sort()).toEqual(["a", "b"]);
    expect(vote.roomSize).toBe(3);
    expect(tally(vote)).toEqual({ yes: 1, no: 0 });
    expect(voteOnWire(vote).voters).toBe(2);
    expect(store.cast("chan", "t", false)).toBe("not_eligible");
    expect(store.cast("chan", "a", false)).toBe("already_voted");
  });

  it("ends as soon as everybody who may vote has voted", () => {
    start();
    store.cast("chan", "b", true);
    expect(ended).toHaveLength(1);
    expect(ended[0]!.reason).toBe("complete");
    expect(outcomeOf(ended[0]!.vote, "complete")).toEqual({ outcome: "passed", yes: 2, no: 0 });
    expect(store.running("chan")).toBeUndefined();
  });

  it("ends by itself after a minute; nobody else having voted misses the quorum", () => {
    start();
    vi.advanceTimersByTime(VOTEKICK_MS);
    expect(ended[0]!.reason).toBe("time");
    // Three in the channel, one vote: two would be needed.
    expect(outcomeOf(ended[0]!.vote, "time").outcome).toBe("quorum");
  });

  it("decides nothing when the member left before the end", () => {
    start();
    store.end("chan", "gone");
    expect(outcomeOf(ended[0]!.vote, "gone").outcome).toBe("cancelled");
    // The timer of a vote that ended early must not fire a second time.
    vi.advanceTimersByTime(VOTEKICK_MS * 2);
    expect(ended).toHaveLength(1);
  });

  it("knows no vote and no channel without one", () => {
    expect(store.cast("other", "a", true)).toBe("no_vote");
    expect(store.running("other")).toBeUndefined();
  });

  it("holds a new vote about the same member back for a while", () => {
    store.startCooldown("chan", "t");
    expect(store.cooldownUntil("chan", "t")).not.toBeNull();
    expect(store.cooldownUntil("chan", "b")).toBeNull();
    vi.advanceTimersByTime(VOTEKICK_COOLDOWN_MS + 1);
    expect(store.cooldownUntil("chan", "t")).toBeNull();
  });

  it("forgets everything about a member who was kicked and about a deleted channel", () => {
    store.startCooldown("chan", "t");
    store.clearUser("t");
    expect(store.cooldownUntil("chan", "t")).toBeNull();
    start();
    store.startCooldown("chan", "b");
    store.clearChannel("chan");
    expect(ended[0]!.reason).toBe("gone");
    expect(store.cooldownUntil("chan", "b")).toBeNull();
  });
});
