import { BanRequest, MoveMemberRequest, Permission, SetMemberRolesRequest, SetOwnerRequest, SetStreamBlockedRequest, StopStreamRequest, displayNameOf, type Ban } from "@squorli/protocol";
import { desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can, canTouchRole, outranks, type Actor } from "../authz";
import type { Db } from "../db";
import { bans, channels, memberRoles, members, roles, users } from "../db/schema";
import type { Hub } from "../hub";
import type { LivekitAdmin } from "../livekit/admin";
import { actorOf, broadcastStructure, loadSettings } from "../state";
import type { VoicePresence } from "../voice/presence";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

export async function registerMemberRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence, lk: LivekitAdmin) {
  async function targetOf(userId: string): Promise<Actor | null> {
    return actorOf(db, userId);
  }

  async function removeMember(userId: string, reason: "kicked" | "banned", message: string | null) {
    await db.delete(memberRoles).where(eq(memberRoles.userId, userId));
    await db.delete(members).where(eq(members.userId, userId));
    presence.leaveUser(userId);
    hub.disconnectUser(userId, { type: "removed", reason, message });
  }

  // Eigentuemer (mehrere moeglich): nur Eigentuemer ernennen oder entziehen; nicht sich selbst; der erste Eigentuemer
  // (server_settings.owner_id) bleibt immer. Eigentuemer haben alle Rechte und stehen ueber jeder Rolle (outranks).
  app.put<{ Params: { id: string } }>("/api/members/:id/owner", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!m.actor.isOwner) return reply.code(403).send({ error: "owner_only" });
    const body = SetOwnerRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    if (req.params.id === m.userId) return reply.code(400).send({ error: "self" });
    const [target] = await db.select({ userId: members.userId }).from(members).where(eq(members.userId, req.params.id)).limit(1);
    if (!target) return reply.code(404).send({ error: "not_found" });
    const settings = await loadSettings(db);
    if (!body.data.owner && settings.ownerId === target.userId) return reply.code(403).send({ error: "founder" });
    await db.update(members).set({ isOwner: body.data.owner }).where(eq(members.userId, target.userId));
    req.log.info({ by: m.userId, target: target.userId, owner: body.data.owner }, "Eigentuemerstatus geaendert");
    await broadcastStructure(db, hub, ["members"]);
    return { ok: true };
  });

  // Rollen eines Mitglieds setzen
  app.put<{ Params: { id: string } }>("/api/members/:id/roles", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_ROLES)) return reply.code(403).send({ error: "forbidden" });
    const body = SetMemberRolesRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const target = await targetOf(req.params.id);
    if (!target) return reply.code(404).send({ error: "not_found" });
    if (m.actor.userId !== target.userId && !outranks(m.actor, target)) return reply.code(403).send({ error: "target_above_you" });

    const wanted = body.data.roleIds.length ? await db.select().from(roles).where(inArray(roles.id, body.data.roleIds)) : [];
    if (wanted.length !== new Set(body.data.roleIds).size) return reply.code(400).send({ error: "unknown_role" });
    const current = (await db.select().from(memberRoles).where(eq(memberRoles.userId, target.userId))).map((r) => r.roleId);
    const currentRoles = current.length ? await db.select().from(roles).where(inArray(roles.id, current)) : [];
    // Nur Rollen unterhalb der eigenen Position duerfen hinzugefuegt oder entfernt werden.
    const changed = [...wanted.filter((r) => !current.includes(r.id)), ...currentRoles.filter((r) => !body.data.roleIds.includes(r.id))];
    if (changed.some((r) => r.isDefault || !canTouchRole(m.actor, r.position))) return reply.code(403).send({ error: "role_above_you" });

    await db.delete(memberRoles).where(eq(memberRoles.userId, target.userId));
    const toInsert = wanted.filter((r) => !r.isDefault).map((r) => ({ userId: target.userId, roleId: r.id }));
    if (toInsert.length) await db.insert(memberRoles).values(toInsert);
    await broadcastStructure(db, hub, ["members"]);
    return { ok: true };
  });

  // ---------- Sprachkanal-Moderation (M3): verschieben, Kamera/Bildschirm beenden, Streamen sperren.
  // Recht MODERATE_VOICE und Rang ueber dem Ziel. LiveKit setzt Stummschaltung/Publish-Rechte durch; das WS-Ereignis
  // laesst den Client seine Oberflaeche nachziehen (und beim Verschieben den neuen Raum betreten).
  async function moderationTarget(req: Parameters<typeof requireMember>[1], reply: Parameters<typeof requireMember>[2], targetId: string) {
    const m = await requireMember(db, req, reply);
    if (!m) return null;
    if (!can(m.actor, Permission.MODERATE_VOICE)) { reply.code(403).send({ error: "forbidden" }); return null; }
    const target = await targetOf(targetId);
    if (!target) { reply.code(404).send({ error: "not_found" }); return null; }
    if (target.userId === m.userId) { reply.code(400).send({ error: "self" }); return null; }
    if (!outranks(m.actor, target)) { reply.code(403).send({ error: "target_above_you" }); return null; }
    const [me] = await db.select({ publicKey: users.publicKey, displayName: users.displayName, handle: users.handle }).from(users).where(eq(users.id, m.userId)).limit(1);
    return { m, target, by: me ? displayNameOf(me) : "Moderator" };
  }

  app.post<{ Params: { id: string } }>("/api/members/:id/move", { schema: { params: Params } }, async (req, reply) => {
    const ctx = await moderationTarget(req, reply, req.params.id);
    if (!ctx) return;
    const body = MoveMemberRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    if (!presence.channelOfUser(ctx.target.userId)) return reply.code(409).send({ error: "not_in_voice" });
    if (body.data.channelId) {
      const [ch] = await db.select().from(channels).where(eq(channels.id, body.data.channelId)).limit(1);
      if (!ch || ch.kind !== "voice") return reply.code(404).send({ error: "unknown_channel" });
    }
    hub.sendToUser(ctx.target.userId, { type: "voice.moved", channelId: body.data.channelId, by: ctx.by });
    req.log.info({ by: ctx.m.userId, target: ctx.target.userId, to: body.data.channelId }, "Mitglied verschoben");
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/members/:id/stream/stop", { schema: { params: Params } }, async (req, reply) => {
    const ctx = await moderationTarget(req, reply, req.params.id);
    if (!ctx) return;
    const body = StopStreamRequest.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const room = presence.channelOfUser(ctx.target.userId);
    if (room) await lk.stopStreams(room, ctx.target.userId, body.data);
    hub.sendToUser(ctx.target.userId, { type: "voice.stop", camera: body.data.camera, screen: body.data.screen, by: ctx.by });
    req.log.info({ by: ctx.m.userId, target: ctx.target.userId, ...body.data }, "Kamera/Bildschirm beendet");
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/api/members/:id/stream", { schema: { params: Params } }, async (req, reply) => {
    const ctx = await moderationTarget(req, reply, req.params.id);
    if (!ctx) return;
    const body = SetStreamBlockedRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    await db.update(members).set({ streamBlocked: body.data.blocked }).where(eq(members.userId, ctx.target.userId));
    const room = presence.channelOfUser(ctx.target.userId);
    if (room) {
      const after = await actorOf(db, ctx.target.userId);
      await lk.setCanStream(room, ctx.target.userId, !!after && can(after, Permission.STREAM_VIDEO));
      if (body.data.blocked) {
        await lk.stopStreams(room, ctx.target.userId, { camera: true, screen: true });
        hub.sendToUser(ctx.target.userId, { type: "voice.stop", camera: true, screen: true, by: ctx.by });
      }
    }
    await broadcastStructure(db, hub, ["members"]); // schickt dem Ziel auch seine neuen Rechte ("me")
    req.log.info({ by: ctx.m.userId, target: ctx.target.userId, blocked: body.data.blocked }, "Streamen-Sperre gesetzt");
    return { ok: true };
  });

  // Kick
  app.delete<{ Params: { id: string } }>("/api/members/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.KICK_MEMBERS)) return reply.code(403).send({ error: "forbidden" });
    const target = await targetOf(req.params.id);
    if (!target) return reply.code(404).send({ error: "not_found" });
    if (!outranks(m.actor, target)) return reply.code(403).send({ error: "target_above_you" });
    await removeMember(target.userId, "kicked", null);
    req.log.info({ by: m.userId, target: target.userId }, "Mitglied gekickt");
    await broadcastStructure(db, hub, ["members"]);
    return { ok: true };
  });

  // Bans
  app.get("/api/bans", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.BAN_MEMBERS)) return reply.code(403).send({ error: "forbidden" });
    const rows = await db
      .select({ userId: bans.userId, reason: bans.reason, bannedBy: bans.bannedBy, createdAt: bans.createdAt, publicKey: users.publicKey, displayName: users.displayName })
      .from(bans).innerJoin(users, eq(users.id, bans.userId)).orderBy(desc(bans.createdAt));
    const out: Ban[] = rows.map((r) => ({ userId: r.userId, displayName: displayNameOf(r), reason: r.reason, bannedBy: r.bannedBy, createdAt: r.createdAt.toISOString() }));
    return out;
  });

  app.post("/api/bans", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.BAN_MEMBERS)) return reply.code(403).send({ error: "forbidden" });
    const body = BanRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.data.userId)).limit(1);
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (user.id === m.userId) return reply.code(400).send({ error: "cannot_ban_self" });
    const target = await targetOf(user.id);
    // Nicht-Mitglieder (bereits gekickt) duerfen nachtraeglich gebannt werden; Mitglieder nur unterhalb der eigenen Position.
    if (target && !outranks(m.actor, target)) return reply.code(403).send({ error: "target_above_you" });
    await db.insert(bans).values({ userId: user.id, bannedBy: m.userId, reason: body.data.reason ?? null }).onConflictDoNothing();
    await removeMember(user.id, "banned", body.data.reason ?? null);
    req.log.info({ by: m.userId, target: user.id }, "Mitglied gebannt");
    await broadcastStructure(db, hub, ["members"]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/bans/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.BAN_MEMBERS)) return reply.code(403).send({ error: "forbidden" });
    const gone = await db.delete(bans).where(eq(bans.userId, req.params.id)).returning({ userId: bans.userId });
    if (!gone.length) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}
