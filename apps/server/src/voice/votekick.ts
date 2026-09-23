import { Permission, VOTEKICK_BLOCK_MS, VOTEKICK_COOLDOWN_MS, VOTEKICK_MIN_MEMBERS, VOTEKICK_MS, hasPermission, type VoteKick, type VoteKickOutcome, voteKickOutcome } from "@squorli/protocol";
import { randomUUID } from "node:crypto";

/**
 * Vote kick in a voice channel (docs/features/votekick.md, 23 September 2026). The rules live in the protocol package
 * (`voteKickQuorum`, `voteKickOutcome`), the running votes, the blocks and the cooldowns live here: in memory, single
 * node, like `VoicePresence` and `MoveGrants`. A restart forgets every running vote and every block, and the members
 * simply vote again.
 *
 * Who may vote is fixed when the vote starts (user's decision): everybody sitting in the channel then, except the member
 * the vote is about; the starter's yes is already in. Joining afterwards gives no vote and changes no quorum, leaving
 * counts as not having voted. The vote ends when the minute is over or when everybody who may vote has voted; the caller
 * gets it through `onEnd` in both cases and does the rest (remove from the channel, tell everybody).
 */

export type RunningVote = {
  id: string;
  channelId: string;
  targetId: string;
  targetName: string;
  startedBy: string;
  startedByName: string;
  startedAt: number;
  endsAt: number;
  /** Everybody who may vote (the starter included), fixed at the start. */
  electorate: Set<string>;
  /** Everybody who sat in the channel at the start, the member the vote is about included: the quorum counts over this. */
  roomSize: number;
  votes: Map<string, boolean>;
};

export type StartInput = {
  channelId: string;
  targetId: string;
  targetName: string;
  startedBy: string;
  startedByName: string;
  /** Everybody sitting in the channel right now, the member the vote is about included. */
  memberIds: string[];
};

/** Why a vote ended: the timer, everybody having voted, or the member leaving the channel. */
export type EndReason = "time" | "complete" | "gone";

const key = (channelId: string, userId: string) => `${channelId}:${userId}`;

export class VoteKicks {
  private readonly byChannel = new Map<string, { vote: RunningVote; timer: NodeJS.Timeout; onEnd: (vote: RunningVote, reason: EndReason) => void }>();
  /** channel:user -> until when the member voted out cannot enter that channel again (ms). */
  private readonly blocks = new Map<string, number>();
  /** channel:user -> until when no new vote about that member may start there (ms). */
  private readonly cooldowns = new Map<string, number>();

  running(channelId: string): RunningVote | undefined {
    return this.byChannel.get(channelId)?.vote;
  }

  /** Starts the vote; the caller has checked everything the rules require (routes/votekick.ts). */
  start(i: StartInput, onEnd: (vote: RunningVote, reason: EndReason) => void, now = Date.now()): RunningVote {
    const electorate = new Set(i.memberIds.filter((id) => id !== i.targetId));
    const vote: RunningVote = {
      id: randomUUID(), channelId: i.channelId, targetId: i.targetId, targetName: i.targetName,
      startedBy: i.startedBy, startedByName: i.startedByName,
      startedAt: now, endsAt: now + VOTEKICK_MS, electorate, roomSize: i.memberIds.length,
      // Whoever starts the vote has voted yes (user's rule).
      votes: new Map([[i.startedBy, true]]),
    };
    const timer = setTimeout(() => this.end(i.channelId, "time"), VOTEKICK_MS);
    timer.unref();
    this.byChannel.set(i.channelId, { vote, timer, onEnd });
    return vote;
  }

  /**
   * A member votes. "not_eligible" = not one of the voters fixed at the start (the member the vote is about, or somebody
   * who joined later), "already_voted" = one vote per member (no changing it), "no_vote" = nothing running here.
   */
  cast(channelId: string, userId: string, yes: boolean): RunningVote | "no_vote" | "not_eligible" | "already_voted" {
    const entry = this.byChannel.get(channelId);
    if (!entry) return "no_vote";
    if (!entry.vote.electorate.has(userId)) return "not_eligible";
    if (entry.vote.votes.has(userId)) return "already_voted";
    entry.vote.votes.set(userId, yes);
    // Everybody who may vote has voted: no reason to wait for the minute to be over.
    if (entry.vote.votes.size >= entry.vote.electorate.size) this.end(channelId, "complete");
    return entry.vote;
  }

  /** Ends the vote of a channel (the timer, a complete vote, or the member leaving); does nothing when none runs. */
  end(channelId: string, reason: EndReason): void {
    const entry = this.byChannel.get(channelId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.byChannel.delete(channelId);
    entry.onEnd(entry.vote, reason);
  }

  /** After a vote about somebody: no new one about them in that channel for a while, whatever the outcome was. */
  startCooldown(channelId: string, targetId: string, now = Date.now()): void {
    this.cooldowns.set(key(channelId, targetId), now + VOTEKICK_COOLDOWN_MS);
  }

  /** Until when no new vote about this member may start here (null = now). */
  cooldownUntil(channelId: string, targetId: string, now = Date.now()): number | null {
    const until = this.cooldowns.get(key(channelId, targetId));
    if (until === undefined) return null;
    if (until <= now) { this.cooldowns.delete(key(channelId, targetId)); return null; }
    return until;
  }

  /** The vote passed: the member cannot enter this one channel again for VOTEKICK_BLOCK_MS. */
  block(channelId: string, userId: string, now = Date.now()): number {
    const until = now + VOTEKICK_BLOCK_MS;
    this.blocks.set(key(channelId, userId), until);
    return until;
  }

  /** Until when the member is kept out of this channel (null = not at all). Asked at the token and at `voice.join`. */
  blockedUntil(channelId: string, userId: string, now = Date.now()): number | null {
    const until = this.blocks.get(key(channelId, userId));
    if (until === undefined) return null;
    if (until <= now) { this.blocks.delete(key(channelId, userId)); return null; }
    return until;
  }

  /** A moderator may always put somebody back (the move grant wins), and a kick/ban clears what is left over. */
  clearUser(userId: string): void {
    for (const k of [...this.blocks.keys()]) if (k.endsWith(`:${userId}`)) this.blocks.delete(k);
    for (const k of [...this.cooldowns.keys()]) if (k.endsWith(`:${userId}`)) this.cooldowns.delete(k);
  }

  clearChannel(channelId: string): void {
    this.end(channelId, "gone");
    for (const k of [...this.blocks.keys()]) if (k.startsWith(`${channelId}:`)) this.blocks.delete(k);
    for (const k of [...this.cooldowns.keys()]) if (k.startsWith(`${channelId}:`)) this.cooldowns.delete(k);
  }
}

/** The one instance; the routes give it its effects, the token route and the WS handler ask it about blocks. */
export const voteKicks = new VoteKicks();

/**
 * May a vote be started in this channel at all? The user's rule: at least three members sit in it and none of them may
 * throw anybody out by themselves. "May throw out" = `MOVE_MEMBERS` resolved in this channel (that is what removes
 * somebody from a voice channel) or `KICK_MEMBERS` server-wide; owners and administrators hold both anyway.
 * This also answers `voice.state.voteKick`, which is what the clients offer the menu entry by.
 */
export function voteKickOffered(i: { allowVoteKick: boolean; memberIds: string[]; running: boolean; moderator: (userId: string) => boolean }): boolean {
  if (!i.allowVoteKick || i.running || i.memberIds.length < VOTEKICK_MIN_MEMBERS) return false;
  return !i.memberIds.some((id) => i.moderator(id));
}

/** Whoever holds this in the channel settles such things themselves: then there is nothing to vote about. */
export function isVoiceModerator(channelMask: number, serverMask: number): boolean {
  return hasPermission(channelMask, Permission.MOVE_MEMBERS) || hasPermission(serverMask, Permission.KICK_MEMBERS);
}

/** The counts only, never who voted how: that is all the wire ever carries. */
export function tally(vote: RunningVote): { yes: number; no: number } {
  const votes = [...vote.votes.values()];
  const yes = votes.filter((v) => v).length;
  return { yes, no: votes.length - yes };
}

/** How the vote ended. A member who left before the end decides nothing (`cancelled`), whatever the counts say. */
export function outcomeOf(vote: RunningVote, reason: EndReason): { outcome: VoteKickOutcome; yes: number; no: number } {
  const { yes, no } = tally(vote);
  return { outcome: reason === "gone" ? "cancelled" : voteKickOutcome({ yes, no, roomSize: vote.roomSize }), yes, no };
}

/** A running vote as the clients see it. */
export function voteOnWire(vote: RunningVote): VoteKick {
  const { yes, no } = tally(vote);
  return {
    id: vote.id, channelId: vote.channelId, targetId: vote.targetId, targetName: vote.targetName,
    startedBy: vote.startedBy, startedByName: vote.startedByName,
    startedAt: new Date(vote.startedAt).toISOString(), endsAt: new Date(vote.endsAt).toISOString(),
    yes, no, voters: vote.electorate.size, roomSize: vote.roomSize,
  };
}
