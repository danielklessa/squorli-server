import { CreateMessageRequest, Permission, UpdateMessageRequest, type Attachment, type Message, type MessagePage } from "@squorli/protocol";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { attachments, channels, messages } from "../db/schema";
import type { Hub } from "../hub";

const PAGE = 50;
const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

export function attachmentUrl(a: { id: string; name: string }): string {
  return `/api/attachments/${a.id}/${encodeURIComponent(a.name)}`;
}

export async function loadMessages(db: Db, rows: (typeof messages.$inferSelect)[]): Promise<Message[]> {
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
    attachments: byMsg.get(r.id) ?? [], createdAt: r.createdAt.toISOString(), editedAt: r.editedAt?.toISOString() ?? null,
  }));
}

export async function registerMessageRoutes(app: FastifyInstance, db: Db, hub: Hub) {
  async function textChannel(id: string) {
    const [c] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
    return c && c.kind === "text" ? c : null;
  }

  /** Verlauf, neueste zuerst geladen, aelteste-zuerst geliefert. ?before=<seq> blaettert zurueck. */
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
      const page = await loadMessages(db, rows.slice(0, limit).reverse());
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
      // Nur eigene, noch nicht verknuepfte Uploads.
      const mine = await db.select({ id: attachments.id }).from(attachments)
        .where(and(inArray(attachments.id, attIds), eq(attachments.uploaderId, m.userId), isNull(attachments.messageId)));
      if (mine.length !== new Set(attIds).size) return reply.code(400).send({ error: "unknown_attachment" });
    }

    const [row] = await db.insert(messages).values({ channelId: ch.id, authorId: m.userId, content: body.data.content }).returning();
    if (attIds.length) await db.update(attachments).set({ messageId: row!.id }).where(inArray(attachments.id, attIds));
    const [msg] = await loadMessages(db, [row!]);
    hub.broadcast({ type: "message.create", message: msg! });
    return msg;
  });

  app.patch<{ Params: { id: string } }>("/api/messages/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const body = UpdateMessageRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.select().from(messages).where(eq(messages.id, req.params.id)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.authorId !== m.userId) return reply.code(403).send({ error: "forbidden" }); // Bearbeiten nur der Autor
    const [updated] = await db.update(messages).set({ content: body.data.content, editedAt: new Date() }).where(eq(messages.id, row.id)).returning();
    const [msg] = await loadMessages(db, [updated!]);
    hub.broadcast({ type: "message.update", message: msg! });
    return msg;
  });

  app.delete<{ Params: { id: string } }>("/api/messages/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const [row] = await db.select().from(messages).where(eq(messages.id, req.params.id)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.authorId !== m.userId && !can(m.actor, Permission.MANAGE_MESSAGES)) return reply.code(403).send({ error: "forbidden" });
    const files = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.messageId, row.id));
    await db.delete(messages).where(eq(messages.id, row.id)); // Anhaenge kaskadieren in der DB
    await app.removeAttachmentFiles(files.map((f) => f.id));
    hub.broadcast({ type: "message.delete", channelId: row.channelId, id: row.id });
    return { ok: true };
  });
}
