import { z } from "zod";
import { Iso, Uuid } from "./primitives";

/**
 * Vote kick in a voice channel (docs/features/votekick.md, 23 September 2026, user's wish): where at least three members
 * sit and nobody present may throw anybody out (no `MOVE_MEMBERS` in that channel, no `KICK_MEMBERS`), the members
 * themselves may vote somebody out of the channel for a while.
 *
 * The rules, all decided by the user: the starter counts as a yes, the member the vote is about does not vote, everyone
 * else is asked; the vote runs for one minute; a tie leaves the member in the channel; at the end at least half of
 * everybody who sat in the channel when the vote started (the member it is about included) must have cast a vote, else it
 * does not count. Who may vote is fixed at the start, so joining afterwards changes nothing.
 *
 * The numbers live here because server and client both compute with them: the server decides, the client shows the same
 * result without asking again.
 */
export const VOTEKICK_MS = 60_000;
/** Fewer than this many in the channel: no vote (the user's rule "mindestens 3 Benutzer"). */
export const VOTEKICK_MIN_MEMBERS = 3;
/** A member voted out cannot enter that one channel again for this long (user's decision, 23 September 2026). */
export const VOTEKICK_BLOCK_MS = 15 * 60_000;
/** After a vote about somebody ended, no new vote about them in that channel for this long (Claude's decision, not asked). */
export const VOTEKICK_COOLDOWN_MS = 5 * 60_000;
/** The result stays on screen this long (user's wish: "verschwindet nach 30 Sekunden wieder"); the client times it. */
export const VOTEKICK_RESULT_MS = 30_000;

/**
 * How a vote ended. `passed` = out of the channel; `tie` = as many no as yes (the member stays, user's rule); `rejected` =
 * more no than yes; `quorum` = too few of the channel voted; `cancelled` = the member left the channel (or the channel is
 * gone) before the end.
 */
export const VoteKickOutcome = z.enum(["passed", "rejected", "tie", "quorum", "cancelled"]);

/** A running vote, as everybody in the channel sees it. Who voted how is never sent, only the counts. */
export const VoteKick = z.object({
  id: Uuid,
  channelId: Uuid,
  targetId: Uuid,
  targetName: z.string(),
  startedBy: Uuid,
  startedByName: z.string(),
  startedAt: Iso,
  endsAt: Iso,
  yes: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  /** How many may vote (everybody in the channel at the start except the member the vote is about). */
  voters: z.number().int().nonnegative(),
  /** How many sat in the channel at the start, the member the vote is about included: the quorum counts over this. */
  roomSize: z.number().int().nonnegative(),
});

export const VoteKickResult = z.object({
  channelId: Uuid,
  targetId: Uuid,
  targetName: z.string(),
  outcome: VoteKickOutcome,
  yes: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  roomSize: z.number().int().nonnegative(),
  /** With `passed`: until when the member cannot enter this channel again. */
  blockedUntil: Iso.nullable().default(null),
});

/** POST /api/channels/:id/votekick */
export const StartVoteKickRequest = z.object({ targetId: Uuid });
/** POST /api/channels/:id/votekick/vote */
export const CastVoteKickRequest = z.object({ yes: z.boolean() });

/** How many votes must be cast for the vote to count: at least half of everybody who sat in the channel at the start. */
export function voteKickQuorum(roomSize: number): number {
  return Math.ceil(roomSize / 2);
}

/**
 * The outcome of a finished vote. Order of the checks: the quorum first (a vote nobody took part in decides nothing),
 * then the majority, and a tie leaves the member in the channel.
 */
export function voteKickOutcome(i: { yes: number; no: number; roomSize: number }): "passed" | "rejected" | "tie" | "quorum" {
  if (i.yes + i.no < voteKickQuorum(i.roomSize)) return "quorum";
  if (i.yes > i.no) return "passed";
  return i.yes === i.no ? "tie" : "rejected";
}

export type VoteKickOutcome = z.infer<typeof VoteKickOutcome>;
export type VoteKick = z.infer<typeof VoteKick>;
export type VoteKickResult = z.infer<typeof VoteKickResult>;
export type StartVoteKickRequest = z.infer<typeof StartVoteKickRequest>;
export type CastVoteKickRequest = z.infer<typeof CastVoteKickRequest>;
