import { CreateCategoryRequest, CreateChannelRequest, DEFAULT_AUDIO_BITRATE, Permission, UpdateCategoryRequest, UpdateChannelRequest } from "@squorli/protocol";
import { eq, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { categories, channels } from "../db/schema";
import type { Hub } from "../hub";
import { broadcastStructure } from "../state";
import type { VoicePresence } from "../voice/presence";
import { compact } from "../util";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

export async function registerChannelRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence) {
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

  app.patch<{ Params: { id: string } }>("/api/categories/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const body = UpdateCategoryRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.update(categories).set(compact(body.data)).where(eq(categories.id, req.params.id)).returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["categories"]);
    return row;
  });

  app.delete<{ Params: { id: string } }>("/api/categories/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const gone = await db.delete(categories).where(eq(categories.id, req.params.id)).returning({ id: categories.id });
    if (!gone.length) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["categories", "channels"]); // channels lose their category (FK set null)
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
    }).returning();
    await broadcastStructure(db, hub, ["channels"]);
    return row;
  });

  app.patch<{ Params: { id: string } }>("/api/channels/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const body = UpdateChannelRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.update(channels).set(compact(body.data)).where(eq(channels.id, req.params.id)).returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["channels"]);
    return row;
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const gone = await db.delete(channels).where(eq(channels.id, req.params.id)).returning({ id: channels.id });
    if (!gone.length) return reply.code(404).send({ error: "not_found" });
    presence.clearChannel(req.params.id);
    // "settings" too: deleting the AFK channel clears server_settings.afk_channel_id (FK set null).
    await broadcastStructure(db, hub, ["channels", "settings"]);
    return { ok: true };
  });
}
