import { describe, expect, it } from "vitest";
import { Channel, ServerEvent, ServerVoiceState } from "./index";
import { VOTEKICK_MIN_MEMBERS, voteKickOutcome, voteKickQuorum } from "./votekick";

describe("voteKickQuorum", () => {
  it("is at least half of everybody who sat in the channel", () => {
    expect(voteKickQuorum(VOTEKICK_MIN_MEMBERS)).toBe(2);
    expect(voteKickQuorum(4)).toBe(2);
    expect(voteKickQuorum(5)).toBe(3);
    expect(voteKickQuorum(10)).toBe(5);
  });
});

describe("voteKickOutcome", () => {
  it("counts a majority of yes", () => {
    expect(voteKickOutcome({ yes: 2, no: 0, roomSize: 3 })).toBe("passed");
    expect(voteKickOutcome({ yes: 3, no: 2, roomSize: 6 })).toBe("passed");
  });
  it("leaves the member in the channel on a tie (user's rule)", () => {
    expect(voteKickOutcome({ yes: 1, no: 1, roomSize: 3 })).toBe("tie");
    expect(voteKickOutcome({ yes: 2, no: 2, roomSize: 4 })).toBe("tie");
  });
  it("rejects a majority of no", () => {
    expect(voteKickOutcome({ yes: 1, no: 2, roomSize: 3 })).toBe("rejected");
  });
  it("does not count without the quorum, whatever the votes say", () => {
    // Four in the channel, only the starter voted: two votes would be needed.
    expect(voteKickOutcome({ yes: 1, no: 0, roomSize: 4 })).toBe("quorum");
    expect(voteKickOutcome({ yes: 0, no: 0, roomSize: 3 })).toBe("quorum");
    // The quorum counts votes, not yes: two of three is enough to decide.
    expect(voteKickOutcome({ yes: 1, no: 1, roomSize: 3 })).toBe("tie");
  });
});

describe("the wire", () => {
  it("gives a channel of a server from before the vote kick and a voice state without the flag defaults", () => {
    const c = Channel.parse({ id: crypto.randomUUID(), kind: "voice", name: "Lobby", topic: null, categoryId: null, position: 0, audioBitrate: 64, audioStereo: false });
    expect(c.allowVoteKick).toBe(true);
    expect(ServerVoiceState.parse({ type: "voice.state", channelId: crypto.randomUUID(), members: [] }).voteKick).toBe(false);
  });

  it("parses the two events", () => {
    const channelId = crypto.randomUUID(), targetId = crypto.randomUUID();
    const vote = { id: crypto.randomUUID(), channelId, targetId, targetName: "B", startedBy: crypto.randomUUID(), startedByName: "A", startedAt: new Date().toISOString(), endsAt: new Date().toISOString(), yes: 1, no: 0, voters: 2, roomSize: 3 };
    const running = ServerEvent.parse({ type: "votekick", channelId, vote });
    expect(running.type === "votekick" && running.canVote).toBe(false);
    const done = ServerEvent.parse({ type: "votekick.result", result: { channelId, targetId, targetName: "B", outcome: "passed", yes: 2, no: 0, roomSize: 3, blockedUntil: new Date().toISOString() } });
    expect(done.type === "votekick.result" && done.result.outcome).toBe("passed");
  });
});
