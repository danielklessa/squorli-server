import { VOTEKICK_MIN_MEMBERS, voteKickQuorum, type Member, type Role, type VoteKick, type VoteKickOutcome } from "@squorli/protocol";
import { topRoleOf } from "./memberRank";

/**
 * Vote kick in a voice channel (docs/features/votekick.md), client side: what the menus offer and what the box above the
 * member list shows. The rules themselves are the server's; everything here only reads what it sent.
 *
 * Whether a vote may be started at all is not computed here: the client cannot resolve another member's permissions in a
 * channel. The server says so per channel in `voice.state` (`voteKick`), and `ServerConnState.voteKickAllowed` keeps it.
 */
export { VOTEKICK_MIN_MEMBERS };

/** What the connection keeps about the running vote of the channel one sits in. */
export type VoteKickState = { vote: VoteKick; myVote: "yes" | "no" | null; canVote: boolean };

/** How the member the vote is about is drawn: like everywhere else (avatar or initials, name in their role's colour). */
export type VoteKickPerson = { displayName: string; avatarUrl: string | null; color: string | null; online: boolean; afk: boolean };

/**
 * The member the vote is about, out of the server's member list (user's wish, 23 September 2026: show them like members are
 * shown everywhere else). Somebody who is no longer a member keeps the name the vote carries, without an avatar or colour.
 */
export function voteKickPerson(i: { userId: string; fallbackName: string; members: readonly Member[]; roles: readonly Role[] }): VoteKickPerson {
  const m = i.members.find((x) => x.userId === i.userId);
  if (!m) return { displayName: i.fallbackName, avatarUrl: null, color: null, online: false, afk: false };
  return { displayName: m.displayName, avatarUrl: m.avatarUrl, color: topRoleOf(m, i.roles)?.color ?? null, online: m.online, afk: m.afk };
}

type Seat = { userId: string };

/** The voice channel a member sits in on this server, null = none. */
export function voiceChannelOf(voice: Record<string, Seat[]>, userId: string): string | null {
  return Object.keys(voice).find((id) => (voice[id] ?? []).some((m) => m.userId === userId)) ?? null;
}

/**
 * In which channel a vote about `targetId` may be started from here, null = the menu offers nothing: the server allows it
 * in that channel right now, both of us sit in it, and it is not about myself. The server checks all of it again.
 */
export function voteKickChannel(i: { voice: Record<string, Seat[]>; voteKickAllowed: Record<string, boolean>; myUserId: string; targetId: string }): string | null {
  if (i.targetId === i.myUserId) return null;
  const mine = voiceChannelOf(i.voice, i.myUserId);
  if (!mine || !i.voteKickAllowed[mine]) return null;
  return voiceChannelOf(i.voice, i.targetId) === mine ? mine : null;
}

/** What the box shows: the counts, how many votes are still missing for the vote to count at all. */
export function voteCounts(vote: VoteKick): { yes: number; no: number; cast: number; quorum: number; missing: number } {
  const cast = vote.yes + vote.no;
  const quorum = voteKickQuorum(vote.roomSize);
  return { yes: vote.yes, no: vote.no, cast, quorum, missing: Math.max(0, quorum - cast) };
}

/**
 * The bar (user's wish, 23 September 2026: "das ja nein bitte als Balken optisch darstellen"): the full width is everybody
 * who sat in the channel when the vote started, so the empty part is what has not voted yet and the mark sits where the
 * quorum is reached. Percentages with one decimal.
 */
export function voteBar(i: { yes: number; no: number; roomSize: number }): { yes: number; no: number; quorum: number } {
  const total = Math.max(1, i.roomSize);
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  return { yes: pct(i.yes), no: pct(i.no), quorum: pct(voteKickQuorum(i.roomSize)) };
}

/** Whole seconds until the vote is over (never below 0), for the countdown. */
export function secondsLeft(endsAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
}

/** The catalog key for how the vote ended. */
export function outcomeKey(outcome: VoteKickOutcome): `votekick.res.${VoteKickOutcome}` {
  return `votekick.res.${outcome}`;
}

/** How many minutes a member voted out has to wait before that channel takes them again (rounded up, at least 1). */
export function blockMinutes(blockedUntil: string | null, now: number): number {
  return blockedUntil ? Math.max(1, Math.ceil((Date.parse(blockedUntil) - now) / 60_000)) : 0;
}
