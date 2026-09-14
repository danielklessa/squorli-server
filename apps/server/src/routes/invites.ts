import { CreateInviteRequest, InviteCode, Permission, type Invite, type InvitePreview } from "@squorli/protocol";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { invites, members } from "../db/schema";
import { loadSettings } from "../state";

const toInvite = (r: typeof invites.$inferSelect): Invite => ({
  code: r.code, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt?.toISOString() ?? null, maxUses: r.maxUses, uses: r.uses,
});

export function inviteIsValid(r: typeof invites.$inferSelect, now = Date.now()): boolean {
  if (r.revokedAt) return false;
  if (r.expiresAt && r.expiresAt.getTime() <= now) return false;
  if (r.maxUses !== null && r.uses >= r.maxUses) return false;
  return true;
}

export async function registerInviteRoutes(app: FastifyInstance, db: Db) {
  app.post("/api/invites", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.CREATE_INVITES)) return reply.code(403).send({ error: "forbidden" });
    const body = CreateInviteRequest.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const code = randomBytes(9).toString("base64url"); // 12 Zeichen
    const expiresAt = body.data.expiresInHours ? new Date(Date.now() + body.data.expiresInHours * 3_600_000) : null;
    const [row] = await db.insert(invites).values({ code, createdBy: m.userId, expiresAt, maxUses: body.data.maxUses ?? null }).returning();
    return toInvite(row!);
  });

  /** Eigene Einladungen; mit MANAGE_SERVER alle. */
  app.get("/api/invites", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const all = can(m.actor, Permission.MANAGE_SERVER);
    const rows = await db.select().from(invites)
      .where(all ? isNull(invites.revokedAt) : and(isNull(invites.revokedAt), eq(invites.createdBy, m.userId)))
      .orderBy(desc(invites.createdAt));
    return rows.map(toInvite);
  });

  app.delete<{ Params: { code: string } }>("/api/invites/:code", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const code = InviteCode.safeParse(req.params.code);
    if (!code.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.select().from(invites).where(eq(invites.code, code.data)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.createdBy !== m.userId && !can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.code, code.data));
    return { ok: true };
  });

  /** Oeffentliche Vorschau fuer die Einladungsseite, ohne Anmeldung. */
  app.get<{ Params: { code: string } }>("/api/invites/:code", async (req, reply) => {
    const code = InviteCode.safeParse(req.params.code);
    if (!code.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db.select().from(invites).where(eq(invites.code, code.data)).limit(1);
    const settings = await loadSettings(db);
    const [mc] = await db.select({ n: count() }).from(members);
    const out: InvitePreview = { serverName: settings.name, memberCount: mc?.n ?? 0, valid: !!row && inviteIsValid(row) };
    return out;
  });
}
