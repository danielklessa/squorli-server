import { Permission, hasPermission } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireMember, type MemberContext } from "./auth/session";
import type { Db } from "./db";
import { channels } from "./db/schema";
import { visibility } from "./visibility";

export type ChannelRow = typeof channels.$inferSelect;
export type ChannelContext = MemberContext & { channel: ChannelRow; perms: number };

/**
 * A member's permissions in one channel (docs/features/channel-permissions.md). null = no such channel, wrong kind, or
 * the member may not see it: all three look the same from outside, which is the point (a 403 would say the channel exists).
 */
export async function resolveChannel(db: Db, userId: string, channelId: string, kind?: "text" | "voice"): Promise<{ channel: ChannelRow; perms: number } | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel || (kind && channel.kind !== kind)) return null;
  await visibility.refresh(db);
  const perms = visibility.masksOf(userId).get(channel.id) ?? 0;
  if (!hasPermission(perms, Permission.VIEW_CHANNELS)) return null;
  return { channel, perms };
}

/**
 * requireMember() plus the channel and the member's permissions in it. Answers 404 `unknown_channel` itself when the
 * channel is missing, of the wrong kind or invisible to the member (the standing rule: never 403 for an invisible channel).
 * The caller then checks the specific right with `can(ctx.perms, Permission.X)` and answers 403.
 */
export async function channelActor(db: Db, req: FastifyRequest, reply: FastifyReply, channelId: string, kind?: "text" | "voice"): Promise<ChannelContext | null> {
  const m = await requireMember(db, req, reply);
  if (!m) return null;
  const r = await resolveChannel(db, m.userId, channelId, kind);
  if (!r) { await reply.code(404).send({ error: "unknown_channel" }); return null; }
  return { ...m, ...r };
}

/** The channel-scoped counterpart of authz.can(): a right in this channel. */
export const canIn = (perms: number, perm: number) => hasPermission(perms, perm);
