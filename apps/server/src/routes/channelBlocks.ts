import { Permission, SetChannelBlockRequest, displayNameOf, type ChannelBlock } from "@squorli/protocol";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { outranks } from "../authz";
import { canIn, channelActor } from "../channelGuard";
import type { Db } from "../db";
import { users } from "../db/schema";
import type { Hub } from "../hub";
import type { LivekitAdmin } from "../livekit/admin";
import { actorOf } from "../state";
import { visibility } from "../visibility";
import { channelBlockStore, type BlockEntry } from "../voice/channelBlocks";
import { moveGrants } from "../voice/confine";
import type { VoicePresence } from "../voice/presence";
import { releaseOnLeave } from "../voice/sticky";
import { removeLater } from "../voice/removeLater";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;
const UserParams = { type: "object", properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" } }, required: ["id", "userId"] } as const;

/**
 * Channel blocks (docs/features/channel-blocks.md, 24 September 2026, user's wish): a moderator removes somebody from a
 * voice channel and keeps them out of it for 5, 15, 30 or 60 minutes or for good, and lifts such blocks again (a vote
 * kick's block included). The right is `MOVE_MEMBERS` resolved in the channel, the same that removes somebody from it;
 * setting one also needs a rank above the member, lifting one does not. The store is voice/channelBlocks.ts.
 */
export async function registerChannelBlockRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence, lk: LivekitAdmin) {
  async function onWire(entries: BlockEntry[]): Promise<ChannelBlock[]> {
    const ids = [...new Set(entries.flatMap((e) => (e.blockedBy ? [e.blockedBy] : [])))];
    const names = new Map((ids.length ? await db.select({ id: users.id, publicKey: users.publicKey, displayName: users.displayName, handle: users.handle }).from(users).where(inArray(users.id, ids)) : []).map((u) => [u.id, displayNameOf(u)]));
    return entries.map((e) => ({
      channelId: e.channelId, userId: e.userId, until: e.until === null ? null : new Date(e.until).toISOString(), source: e.source,
      blockedBy: e.blockedBy ? names.get(e.blockedBy) ?? null : null, createdAt: new Date(e.createdAt).toISOString(),
    }));
  }

  /** The running blocks of every channel in which the asker may move members (nothing of channels they cannot see). */
  app.get("/api/channel-blocks", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    await visibility.refresh(db);
    const masks = visibility.masksOf(m.userId);
    const mine = channelBlockStore.all().filter((e) => canIn(masks.get(e.channelId) ?? 0, Permission.VIEW_CHANNELS) && canIn(masks.get(e.channelId) ?? 0, Permission.MOVE_MEMBERS));
    return onWire(mine);
  });

  /** Block a member from this voice channel; when they sit in it they are removed at once. */
  app.put<{ Params: { id: string } }>("/api/channels/:id/blocks", { schema: { params: Params } }, async (req, reply) => {
    const c = await channelActor(db, req, reply, req.params.id, "voice");
    if (!c) return;
    if (!canIn(c.perms, Permission.MOVE_MEMBERS)) return reply.code(403).send({ error: "forbidden" });
    const body = SetChannelBlockRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const targetId = body.data.userId;
    if (targetId === c.userId) return reply.code(400).send({ error: "self" });
    const target = await actorOf(db, targetId);
    if (!target) return reply.code(404).send({ error: "not_found" });
    if (!outranks(c.actor, target)) return reply.code(403).send({ error: "target_above_you" });
    const block = await channelBlockStore.set({ channelId: c.channel.id, userId: targetId, ms: body.data.minutes === null ? null : body.data.minutes * 60_000, source: "moderator", blockedBy: c.userId });
    // A move into this channel the moderator granted earlier must not let them straight back in.
    if (moveGrants.grantOf(targetId) === c.channel.id) moveGrants.clear(targetId);
    if (presence.channelOfUser(targetId) === c.channel.id) {
      // Out of the channel: the client hangs up on `voice.moved` and says why; LiveKit drops the participant whatever the client does.
      hub.sendToUser(targetId, { type: "voice.moved", channelId: null, by: displayNameOf(c), reason: "blocked", until: block.until === null ? null : new Date(block.until).toISOString() });
      presence.leaveUser(targetId);
      removeLater(lk, presence, c.channel.id, targetId, (err) => req.log.warn({ err }, "channel block removeParticipant"));
      await releaseOnLeave(db, hub, presence, targetId).catch((err: unknown) => req.log.warn({ err }, "channel block release"));
    }
    req.log.info({ by: c.userId, target: targetId, channelId: c.channel.id, minutes: body.data.minutes }, "Kanalsperre gesetzt");
    return (await onWire([block]))[0];
  });

  /** Lift a block (a moderator's or a vote kick's). */
  app.delete<{ Params: { id: string; userId: string } }>("/api/channels/:id/blocks/:userId", { schema: { params: UserParams } }, async (req, reply) => {
    const c = await channelActor(db, req, reply, req.params.id, "voice");
    if (!c) return;
    if (!canIn(c.perms, Permission.MOVE_MEMBERS)) return reply.code(403).send({ error: "forbidden" });
    if (!(await channelBlockStore.lift(c.channel.id, req.params.userId))) return reply.code(404).send({ error: "not_found" });
    req.log.info({ by: c.userId, target: req.params.userId, channelId: c.channel.id }, "Kanalsperre aufgehoben");
    return { ok: true };
  });
}
