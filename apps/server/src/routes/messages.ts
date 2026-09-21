import { CreateMessageRequest, Permission, RemovePreviewRequest, UpdateMessageRequest, type Attachment, type Message, type MessagePage } from "@squorli/protocol";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { attachments, channels, messages } from "../db/schema";
import type { Hub } from "../hub";
import { visiblePreviews, type LinkPreviews } from "../previews/service";

const PAGE = 50;
const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

export function attachmentUrl(a: { id: string; name: string }): string {
  return `/api/attachments/${a.id}/${encodeURIComponent(a.name)}`;
}

/** `withPreviews` false = link previews are turned off: the field is left out, which is what tells clients so. */
export async function loadMessages(db: Db, rows: (typeof messages.$inferSelect)[], withPreviews = true): Promise<Message[]> {
  const ids = rows.map((r) => r.id);
  const atts = ids.length ? await db.select().from(attachments).where(inArray(attachments.messageId, ids)) : [];
  const byMsg = new Map<string, Attachment[]>();
  for (const a of atts) {
    const list = byMsg.get(a.messageId!) ?? [];
    list.push({ id: a.id, name: a.name, size: a.size, mimeType: a.mimeType, url: attachmentUrl(a) });
    byMsg.set(a.messageId!, list);
  }
  return rows.map((r) => ({
    id: r.id, seq: r.seq, channelId: r.channelId, authorId: r.authorId, content: r.content,
    attachments: byMsg.get(r.id) ?? [], ...(withPreviews ? { previews: visiblePreviews(r.previews) } : {}),
    createdAt: r.createdAt.toISOString(), editedAt: r.editedAt?.toISOString() ?? null,
  }));
}

export async function registerMessageRoutes(app: FastifyInstance, db: Db, hub: Hub, previews: LinkPreviews) {
  const load = (rows: (typeof messages.$inferSelect)[]) => loadMessages(db, rows, previews.enabled);
  async function textChannel(id: string) {
    const [c] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
    return c && c.kind === "text" ? c : null;
  }

  /** History, loaded newest-first and returned oldest-first. ?before=<seq> pages backwards. */
  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    "/api/channels/:id/messages", { schema: { params: Params } }, async (req, reply) => {
      const m = await requireMember(db, req, reply);
      if (!m) return;
      if (!can(m.actor, Permission.VIEW_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
      const ch = await textChannel(req.params.id);
      if (!ch) return reply.code(404).send({ error: "unknown_channel" });
      const before = req.query.before ? Number(req.query.before) : null;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || PAGE));
      const rows = await db.select().from(messages)
        .where(before !== null && Number.isFinite(before) ? and(eq(messages.channelId, ch.id), lt(messages.seq, before)) : eq(messages.channelId, ch.id))
        .orderBy(desc(messages.seq)).limit(limit + 1);
      const hasMore = rows.length > limit;
      const page = await load(rows.slice(0, limit).reverse());
      const out: MessagePage = { messages: page, hasMore };
      return out;
    });

  app.post<{ Params: { id: string } }>("/api/channels/:id/messages", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.SEND_MESSAGES)) return reply.code(403).send({ error: "forbidden" });
    const body = CreateMessageRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const ch = await textChannel(req.params.id);
    if (!ch) return reply.code(404).send({ error: "unknown_channel" });

    const attIds = body.data.attachmentIds ?? [];
    if (attIds.length) {
      if (!can(m.actor, Permission.ATTACH_FILES)) return reply.code(403).send({ error: "forbidden" });
      // Only your own uploads that are not linked yet.
      const mine = await db.select({ id: attachments.id }).from(attachments)
        .where(and(inArray(attachments.id, attIds), eq(attachments.uploaderId, m.userId), isNull(attachments.messageId)));
      if (mine.length !== new Set(attIds).size) return reply.code(400).send({ error: "unknown_attachment" });
    }

    const [row] = await db.insert(messages).values({ channelId: ch.id, authorId: m.userId, content: body.data.content }).returning();
    if (attIds.length) await db.update(attachments).set({ messageId: row!.id }).where(inArray(attachments.id, attIds));
    const [msg] = await load([row!]);
    hub.broadcast({ type: "message.create", message: msg! });
    // The links are looked up afterwards; the previews follow as a `message.update`.
    previews.schedule(row!.id);
    return msg;
  });

  app.patch<{ Params: { id: string } }>("/api/messages/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const body = UpdateMessageRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.select().from(messages).where(eq(messages.id, req.params.id)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.authorId !== m.userId) return reply.code(403).send({ error: "forbidden" }); // Only the author may edit
    const [updated] = await db.update(messages).set({ content: body.data.content, editedAt: new Date() }).where(eq(messages.id, row.id)).returning();
    const [msg] = await load([updated!]);
    hub.broadcast({ type: "message.update", message: msg! });
    previews.schedule(row.id);
    return msg;
  });

  /** The author takes one preview of their message away (the x next to it); nobody else may, a moderator deletes the message. */
  app.post<{ Params: { id: string } }>("/api/messages/:id/previews/remove", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const body = RemovePreviewRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.select({ authorId: messages.authorId }).from(messages).where(eq(messages.id, req.params.id)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.authorId !== m.userId) return reply.code(403).send({ error: "forbidden" });
    if (!(await previews.remove(req.params.id, body.data.url))) return reply.code(404).send({ error: "unknown_preview" });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/messages/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const [row] = await db.select().from(messages).where(eq(messages.id, req.params.id)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.authorId !== m.userId && !can(m.actor, Permission.MANAGE_MESSAGES)) return reply.code(403).send({ error: "forbidden" });
    const files = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.messageId, row.id));
    await db.delete(messages).where(eq(messages.id, row.id)); // Attachments cascade in the DB
    await app.removeAttachmentFiles(files.map((f) => f.id));
    hub.broadcast({ type: "message.delete", channelId: row.channelId, id: row.id });
    return { ok: true };
  });
}
