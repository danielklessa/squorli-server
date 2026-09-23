import { CreateCategoryRequest, CreateChannelRequest, DEFAULT_AUDIO_BITRATE, Permission, UpdateCategoryRequest, UpdateChannelRequest, hasPermission } from "@squorli/protocol";
import { eq, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import { canIn, channelActor } from "../channelGuard";
import type { Db } from "../db";
import { categories, channels } from "../db/schema";
import type { Hub } from "../hub";
import type { LivekitAdmin } from "../livekit/admin";
import { syncVoiceAccessOf } from "../livekit/sync";
import { broadcastStructure, loadChannels, loadSettings } from "../state";
import { visibility } from "../visibility";
import type { VoicePresence } from "../voice/presence";
import { voteKicks } from "../voice/votekick";
import { releaseAll } from "../voice/sticky";
import { compact } from "../util";

/** The request's channel settings as the table stores them (one name differs). */
function settingsColumns(d: { sticky?: boolean | undefined; stickyPersist?: boolean | undefined; stickyHideVoice?: boolean | undefined; userLimit?: number | null | undefined; slowmodeSeconds?: number | undefined; defaultNotify?: "all" | "mentions" | "none" | undefined; allowRadio?: boolean | undefined; allowVideo?: boolean | undefined; allowVoteKick?: boolean | undefined }) {
  return compact({ sticky: d.sticky, stickyPersist: d.stickyPersist, stickyHideVoice: d.stickyHideVoice, userLimit: d.userLimit, slowmodeSeconds: d.slowmodeSeconds, defaultNotification: d.defaultNotify, allowRadio: d.allowRadio, allowVideo: d.allowVideo, allowVoteKick: d.allowVoteKick });
}

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

export async function registerChannelRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence, lk: LivekitAdmin) {
  // ---- Categories
  app.post("/api/categories", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const body = CreateCategoryRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [top] = await db.select({ m: max(categories.position) }).from(categories);
    const [row] = await db.insert(categories).values({ name: body.data.name, position: (top?.m ?? -1) + 1 }).returning();
    await broadcastStructure(db, hub, ["categories"]);
    return row;
  });

  /** MANAGE_CHANNELS on the category itself (its overwrites count); an invisible category is a 404 like a channel. */
  async function categoryManager(req: Parameters<typeof requireMember>[1], reply: Parameters<typeof requireMember>[2], id: string) {
    const m = await requireMember(db, req, reply);
    if (!m) return null;
    await visibility.refresh(db);
    const perms = visibility.masksOf(m.userId).get(id) ?? 0;
    if (!hasPermission(perms, Permission.VIEW_CHANNELS)) { await reply.code(404).send({ error: "not_found" }); return null; }
    if (!hasPermission(perms, Permission.MANAGE_CHANNELS)) { await reply.code(403).send({ error: "forbidden" }); return null; }
    return m;
  }

  app.patch<{ Params: { id: string } }>("/api/categories/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await categoryManager(req, reply, req.params.id);
    if (!m) return;
    const body = UpdateCategoryRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.update(categories).set(compact(body.data)).where(eq(categories.id, req.params.id)).returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["categories"]);
    return row;
  });

  app.delete<{ Params: { id: string } }>("/api/categories/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await categoryManager(req, reply, req.params.id);
    if (!m) return;
    const gone = await db.delete(categories).where(eq(categories.id, req.params.id)).returning({ id: categories.id });
    if (!gone.length) return reply.code(404).send({ error: "not_found" });
    // The channels lose their category (FK set null) and with it its overwrites: whoever sits in one may have to go.
    await syncVoiceAccessOf(db, hub, presence, lk);
    await broadcastStructure(db, hub, ["categories", "channels"]);
    return { ok: true };
  });

  // ---- Channels
  app.post("/api/channels", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const body = CreateChannelRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [top] = await db.select({ m: max(channels.position) }).from(channels);
    const [row] = await db.insert(channels).values({
      kind: body.data.kind,
      name: body.data.name,
      topic: body.data.topic ?? null,
      categoryId: body.data.categoryId ?? null,
      position: (top?.m ?? -1) + 1,
      audioBitrate: body.data.audioBitrate ?? DEFAULT_AUDIO_BITRATE,
      audioStereo: body.data.audioStereo ?? false,
      ...settingsColumns(body.data),
    }).returning({ id: channels.id });
    await broadcastStructure(db, hub, ["channels"]);
    return (await loadChannels(db)).find((c) => c.id === row!.id);
  });

  app.patch<{ Params: { id: string } }>("/api/channels/:id", { schema: { params: Params } }, async (req, reply) => {
    const c = await channelActor(db, req, reply, req.params.id);
    if (!c) return;
    if (!canIn(c.perms, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const body = UpdateChannelRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const { sticky, stickyPersist, stickyHideVoice, userLimit, slowmodeSeconds, defaultNotify, allowRadio, allowVideo, allowVoteKick, ...plain } = body.data;
    // The AFK channel must not hold anybody (routes/settings.ts refuses the other direction).
    if (sticky && (await loadSettings(db)).afkChannelId === c.channel.id) return reply.code(409).send({ error: "afk_channel_sticky" });
    const [row] = await db.update(channels).set({ ...compact(plain), ...settingsColumns({ sticky, stickyPersist, stickyHideVoice, userLimit, slowmodeSeconds, defaultNotify, allowRadio, allowVideo, allowVoteKick }) }).where(eq(channels.id, c.channel.id)).returning({ id: channels.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    // No longer sticky: everybody it held is free.
    if (c.channel.sticky && sticky === false) await releaseAll(db, hub, c.channel.id);
    // Another category means other inherited overwrites for whoever sits inside (docs/features/channel-permissions.md: live inheritance).
    if ((plain.categoryId !== undefined && plain.categoryId !== c.channel.categoryId) || (allowVideo !== undefined && allowVideo !== c.channel.allowVideo)) await syncVoiceAccessOf(db, hub, presence, lk, { channelIds: [c.channel.id] });
    await broadcastStructure(db, hub, ["channels"]);
    return (await loadChannels(db)).find((ch) => ch.id === row.id);
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id", { schema: { params: Params } }, async (req, reply) => {
    const c = await channelActor(db, req, reply, req.params.id);
    if (!c) return;
    if (!canIn(c.perms, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const gone = await db.delete(channels).where(eq(channels.id, req.params.id)).returning({ id: channels.id });
    if (!gone.length) return reply.code(404).send({ error: "not_found" });
    presence.clearChannel(req.params.id);
    voteKicks.clearChannel(req.params.id);
    // "settings" too: deleting the AFK channel clears server_settings.afk_channel_id (FK set null).
    await broadcastStructure(db, hub, ["channels", "settings"]);
    return { ok: true };
  });
}
