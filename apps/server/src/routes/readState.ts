import { MarkReadRequest, MuteRequest, Permission, type MuteState, type ReadStateResponse } from "@squorli/protocol";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { channelMutes, channels, members, readStates } from "../db/schema";
import type { Hub } from "../hub";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

type Row = { muted: boolean; channel_id: string; last_read_seq: string | number | null; latest_seq: string | number | null; unread: string | number; mentions: string | number };
const num = (v: string | number | null) => (v === null ? null : Number(v));

/**
 * Read states: how far a member has read each text channel, kept here so unread marks and mention counters are the same
 * on all their devices. Only messages of other people count; a channel never opened counts from the day of joining.
 */
export async function registerReadStateRoutes(app: FastifyInstance, db: Db, hub: Hub) {
  /** One query for all text channels: read state, newest message, number of unread messages and of those that mention me. */
  app.get("/api/read-state", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.VIEW_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    // The token as the client stores a mention (apps/web/src/mentions.ts). A plain substring test: a token quoted inside
    // a code block counts here although the client does not render it as a mention; rare, and cheap to live with.
    const token = `%<@${m.userId}>%`;
    const rows = await db.execute(sql`
      SELECT c.id AS channel_id, rs.last_read_seq,
        EXISTS (SELECT 1 FROM channel_mutes cm WHERE cm.channel_id = c.id AND cm.user_id = ${m.userId}) AS muted,
        (SELECT max(seq) FROM messages WHERE channel_id = c.id) AS latest_seq,
        agg.unread, agg.mentions
      FROM channels c
      LEFT JOIN read_states rs ON rs.channel_id = c.id AND rs.user_id = ${m.userId}
      LEFT JOIN LATERAL (
        SELECT count(*) AS unread, count(*) FILTER (WHERE msg.content LIKE ${token}) AS mentions
        FROM messages msg
        WHERE msg.channel_id = c.id AND msg.author_id <> ${m.userId}
          AND CASE WHEN rs.last_read_seq IS NOT NULL THEN msg.seq > rs.last_read_seq
                   ELSE msg.created_at > (SELECT joined_at FROM members WHERE user_id = ${m.userId}) END
      ) agg ON true
      WHERE c.kind = 'text'`) as unknown as Row[];
    const [me] = await db.select({ muted: members.muted }).from(members).where(eq(members.userId, m.userId)).limit(1);
    const out: ReadStateResponse = {
      channels: rows.map((r) => ({ channelId: r.channel_id, lastReadSeq: num(r.last_read_seq), latestSeq: num(r.latest_seq), unread: Number(r.unread) > 0, mentions: Number(r.mentions), muted: r.muted === true })),
      serverMuted: me?.muted ?? false,
    };
    return out;
  });

  /** The member's mutes as a whole; after a change it goes to all their connections so every device shows the same. */
  async function muteState(userId: string): Promise<MuteState> {
    const [me] = await db.select({ muted: members.muted }).from(members).where(eq(members.userId, userId)).limit(1);
    const rows = await db.select({ channelId: channelMutes.channelId }).from(channelMutes).where(eq(channelMutes.userId, userId));
    return { serverMuted: me?.muted ?? false, channelIds: rows.map((r) => r.channelId) };
  }
  async function announce(userId: string): Promise<MuteState> {
    const state = await muteState(userId);
    hub.sendToUser(userId, { type: "mute.update", ...state });
    return state;
  }

  /** Mute or unmute one text channel for myself. Needs no permission beyond seeing channels: it only changes my own view. */
  app.put<{ Params: { id: string } }>("/api/channels/:id/mute", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.VIEW_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const body = MuteRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [ch] = await db.select({ id: channels.id, kind: channels.kind }).from(channels).where(eq(channels.id, req.params.id)).limit(1);
    if (!ch || ch.kind !== "text") return reply.code(404).send({ error: "unknown_channel" });
    if (body.data.muted) await db.insert(channelMutes).values({ userId: m.userId, channelId: ch.id }).onConflictDoNothing();
    else await db.delete(channelMutes).where(and(eq(channelMutes.userId, m.userId), eq(channelMutes.channelId, ch.id)));
    return announce(m.userId);
  });

  /** Mute or unmute this whole server for myself (the mark on the server rail of the multi-server client). */
  app.put("/api/me/mute", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const body = MuteRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    await db.update(members).set({ muted: body.data.muted }).where(eq(members.userId, m.userId));
    return announce(m.userId);
  });

  /** "I have seen this channel up to seq." Never moves backwards and never beyond the newest message of the server. */
  app.post<{ Params: { id: string } }>("/api/channels/:id/read", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.VIEW_CHANNELS)) return reply.code(403).send({ error: "forbidden" });
    const body = MarkReadRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [ch] = await db.select({ id: channels.id, kind: channels.kind }).from(channels).where(eq(channels.id, req.params.id)).limit(1);
    if (!ch || ch.kind !== "text") return reply.code(404).send({ error: "unknown_channel" });

    // A number from the future would hide messages that do not exist yet: cap it at the newest message there is.
    const seq = sql`least(${body.data.seq}::bigint, coalesce((SELECT max(seq) FROM messages), 0))`;
    const [row] = await db.insert(readStates).values({ userId: m.userId, channelId: ch.id, lastReadSeq: seq })
      .onConflictDoUpdate({
        target: [readStates.userId, readStates.channelId],
        set: { lastReadSeq: sql`greatest(${readStates.lastReadSeq}, excluded.last_read_seq)`, updatedAt: new Date() },
      }).returning({ lastReadSeq: readStates.lastReadSeq });
    const lastReadSeq = Number(row!.lastReadSeq);
    // The member's other devices drop their marks right away.
    hub.sendToUser(m.userId, { type: "read.update", channelId: ch.id, lastReadSeq });
    return { lastReadSeq };
  });
}
