import { CastVoteKickRequest, StartVoteKickRequest, VOTEKICK_MIN_MEMBERS, displayNameOf, type VoteKickResult } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { channelActor } from "../channelGuard";
import type { Db } from "../db";
import { users } from "../db/schema";
import type { Hub } from "../hub";
import type { LivekitAdmin } from "../livekit/admin";
import { loadSettings } from "../state";
import { visibility } from "../visibility";
import type { VoicePresence } from "../voice/presence";
import { releaseOnLeave } from "../voice/sticky";
import { voiceStateEvent } from "../voice/voiceState";
import { isVoiceModerator, outcomeOf, voteKicks, voteOnWire, type EndReason, type RunningVote } from "../voice/votekick";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

/**
 * Vote kick in a voice channel (docs/features/votekick.md, 23 September 2026, user's wish). Two routes: start a vote and
 * cast a vote; everything else the members see travels over the WebSocket (`votekick`, `votekick.result`) to whoever sits
 * in the channel. REST and not a client event on purpose: an older server answers 404 instead of `bad_message`, so no
 * `PROTOCOL_VERSION` bump is needed, and the refusals can say why (apiErrorText.ts turns them into sentences).
 *
 * What the rules are and who decided them: `packages/protocol/src/votekick.ts` and the feature notes.
 */
export async function registerVoteKickRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence, lk: LivekitAdmin) {
  /** The running vote (or its end) to everybody sitting in the channel, with what this recipient did about it. */
  const sendState = (channelId: string) => {
    const vote = voteKicks.running(channelId);
    const wire = vote ? voteOnWire(vote) : null;
    for (const m of presence.members(channelId)) {
      const mine = vote?.votes.get(m.userId);
      hub.sendToUser(m.userId, {
        type: "votekick", channelId, vote: wire,
        myVote: mine === undefined ? null : mine ? "yes" : "no",
        canVote: !!vote && vote.electorate.has(m.userId) && !vote.votes.has(m.userId),
      });
    }
  };

  /**
   * A vote is over (time, everybody voted, or the member left): tell everybody, and on a `passed` take the member out of
   * the channel and keep them out of it for a while (user's decision). The member it was about gets the result before the
   * removal, so their client knows why it is hanging up.
   */
  const finish = async (vote: RunningVote, reason: EndReason) => {
    const { outcome, yes, no } = outcomeOf(vote, reason);
    voteKicks.startCooldown(vote.channelId, vote.targetId);
    const passed = outcome === "passed";
    const blockedUntil = passed ? new Date(voteKicks.block(vote.channelId, vote.targetId)).toISOString() : null;
    const result: VoteKickResult = { channelId: vote.channelId, targetId: vote.targetId, targetName: vote.targetName, outcome, yes, no, roomSize: vote.roomSize, blockedUntil };
    // Everybody who sat in the channel when the vote started, plus whoever sits there now: a member who joined later sees
    // the result of the box they were shown, and the member the vote was about learns it even after being removed.
    const recipients = new Set([vote.targetId, ...vote.electorate, ...presence.members(vote.channelId).map((m) => m.userId)]);
    for (const userId of recipients) {
      hub.sendToUser(userId, { type: "votekick", channelId: vote.channelId, vote: null, myVote: null, canVote: false });
      hub.sendToUser(userId, { type: "votekick.result", result });
    }
    if (!passed) return hub.broadcastToChannel(vote.channelId, voiceStateEvent(vote.channelId, presence.members(vote.channelId)));
    // Out of the channel: the client hangs up on `voice.moved`, LiveKit drops the participant whatever the client does.
    const by = await loadSettings(db).then((s) => s.name).catch(() => "");
    hub.sendToUser(vote.targetId, { type: "voice.moved", channelId: null, by });
    presence.leaveUser(vote.targetId);
    await lk.removeParticipant(vote.channelId, vote.targetId).catch((err: unknown) => app.log.warn({ err }, "votekick removeParticipant"));
    await releaseOnLeave(db, hub, presence, vote.targetId).catch((err: unknown) => app.log.warn({ err }, "votekick release"));
    app.log.info({ channelId: vote.channelId, target: vote.targetId, yes, no, roomSize: vote.roomSize }, "Vote-Kick angenommen");
  };

  const onEnd = (vote: RunningVote, reason: EndReason) => { void finish(vote, reason).catch((err: unknown) => app.log.warn({ err }, "votekick finish")); };

  // The member the vote is about left the channel (by themselves, moved, kicked) or the channel is gone: nothing to decide.
  const off = presence.onChange((channelId, members) => {
    const vote = voteKicks.running(channelId);
    if (vote && !members.some((m) => m.userId === vote.targetId)) voteKicks.end(channelId, "gone");
  });
  app.addHook("onClose", async () => off());

  /** Start a vote about somebody in the voice channel one sits in. */
  app.post<{ Params: { id: string } }>("/api/channels/:id/votekick", { schema: { params: Params } }, async (req, reply) => {
    const c = await channelActor(db, req, reply, req.params.id, "voice");
    if (!c) return;
    const body = StartVoteKickRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const channelId = c.channel.id, targetId = body.data.targetId;
    if (!c.channel.allowVoteKick) return reply.code(403).send({ error: "votekick_disabled" });
    if (targetId === c.userId) return reply.code(400).send({ error: "self" });
    const seated = presence.members(channelId);
    if (!seated.some((m) => m.userId === c.userId)) return reply.code(409).send({ error: "not_in_channel" });
    if (!seated.some((m) => m.userId === targetId)) return reply.code(409).send({ error: "target_not_in_channel" });
    if (seated.length < VOTEKICK_MIN_MEMBERS) return reply.code(409).send({ error: "too_few_members" });
    // Somebody present can settle this by themselves: then there is nothing to vote about (the user's rule).
    if (seated.some((m) => isVoiceModerator(visibility.masksOf(m.userId).get(channelId) ?? 0, visibility.actorOf(m.userId)?.permissions ?? 0))) return reply.code(403).send({ error: "moderator_present" });
    if (voteKicks.running(channelId)) return reply.code(409).send({ error: "vote_running" });
    const cooldown = voteKicks.cooldownUntil(channelId, targetId);
    if (cooldown) return reply.code(429).send({ error: "cooldown", retryAfter: Math.ceil((cooldown - Date.now()) / 1000) });

    const [target] = await db.select({ publicKey: users.publicKey, displayName: users.displayName, handle: users.handle }).from(users).where(eq(users.id, targetId)).limit(1);
    const [me] = await db.select({ publicKey: users.publicKey, displayName: users.displayName, handle: users.handle }).from(users).where(eq(users.id, c.userId)).limit(1);
    if (!target || !me) return reply.code(404).send({ error: "not_found" });
    const vote = voteKicks.start({
      channelId, targetId, targetName: displayNameOf(target), startedBy: c.userId, startedByName: displayNameOf(me),
      memberIds: seated.map((m) => m.userId),
    }, onEnd);
    sendState(channelId);
    // The channel offers no second vote while this one runs: everybody's menu entry goes.
    hub.broadcastToChannel(channelId, voiceStateEvent(channelId, presence.members(channelId)));
    req.log.info({ by: c.userId, target: targetId, channelId, voters: vote.electorate.size }, "Vote-Kick gestartet");
    return { ok: true };
  });

  /** Yes or no. One vote per member, no changing it; the member the vote is about never votes (user's rule). */
  app.post<{ Params: { id: string } }>("/api/channels/:id/votekick/vote", { schema: { params: Params } }, async (req, reply) => {
    const c = await channelActor(db, req, reply, req.params.id, "voice");
    if (!c) return;
    const body = CastVoteKickRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const done = voteKicks.cast(c.channel.id, c.userId, body.data.yes);
    if (done === "no_vote") return reply.code(409).send({ error: "no_vote" });
    if (done === "not_eligible") return reply.code(403).send({ error: "not_eligible" });
    if (done === "already_voted") return reply.code(409).send({ error: "already_voted" });
    // A vote that completed the round is already over (the store ended it and `finish` told everybody).
    if (voteKicks.running(c.channel.id)) sendState(c.channel.id);
    return { ok: true };
  });
}
