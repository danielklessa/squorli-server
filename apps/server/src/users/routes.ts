import { UpdateMeRequest, Uuid, type Me, type SessionInfo } from "@squorli/protocol";
import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/session";
import type { Db } from "../db";
import { sessions, users } from "../db/schema";
import type { Hub } from "../hub";
import { broadcastStructure } from "../state";
import type { VoicePresence } from "../voice/presence";

/** Profil des angemeldeten Nutzers (M2: Anzeigename) und seine Sitzungen (M6c: Geraeteverwaltung). Funktioniert auch ohne Mitgliedschaft. */
export async function registerUserRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence) {
  app.get("/api/me", async (req, reply) => {
    const s = await requireSession(db, req, reply);
    if (!s) return;
    const me: Me = { userId: s.userId, publicKey: s.publicKey, displayName: s.displayName, handle: s.handle };
    return me;
  });

  app.patch("/api/me", async (req, reply) => {
    const s = await requireSession(db, req, reply);
    if (!s) return;
    const body = UpdateMeRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });

    await db.update(users).set({ displayName: body.data.displayName }).where(eq(users.id, s.userId));
    // Wer gerade in einem Sprachkanal sitzt, soll dort sofort mit neuem Namen erscheinen.
    presence.rename(s.userId, { displayName: body.data.displayName, publicKey: s.publicKey, handle: s.handle });
    await broadcastStructure(db, hub, ["members"]);

    const me: Me = { userId: s.userId, publicKey: s.publicKey, displayName: body.data.displayName, handle: s.handle };
    return me;
  });

  // ---- M6c: Sitzungen (Geraete). Das Token wird nie zurueckgegeben, nur die Kennung `id`.
  app.get("/api/me/sessions", async (req, reply) => {
    const s = await requireSession(db, req, reply);
    if (!s) return;
    // Abgelaufene Sitzungen bei Gelegenheit aufraeumen; resolveSession lehnt sie ohnehin ab.
    await db.delete(sessions).where(and(eq(sessions.userId, s.userId), lt(sessions.expiresAt, new Date())));
    const rows = await db
      .select({ id: sessions.id, label: sessions.label, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt, expiresAt: sessions.expiresAt })
      .from(sessions).where(eq(sessions.userId, s.userId))
      .orderBy(sql`${sessions.lastUsedAt} desc nulls last`, desc(sessions.createdAt));
    const list: SessionInfo[] = rows.map((r) => ({
      id: r.id, label: r.label, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(), current: r.id === s.sessionId,
    }));
    return list;
  });

  /** Alle anderen Geraete abmelden; deren WebSockets werden mit 4011 geschlossen. */
  app.delete("/api/me/sessions/others", async (req, reply) => {
    const s = await requireSession(db, req, reply);
    if (!s) return;
    const gone = await db.delete(sessions).where(and(eq(sessions.userId, s.userId), ne(sessions.id, s.sessionId))).returning({ id: sessions.id });
    for (const g of gone) hub.disconnectSession(g.id);
    req.log.info({ userId: s.userId, revoked: gone.length }, "andere Sitzungen abgemeldet");
    return { ok: true, revoked: gone.length };
  });

  /** Eigene Sitzung serverseitig beenden (Abmelden im Client). */
  app.delete("/api/me/sessions/current", async (req, reply) => {
    const s = await requireSession(db, req, reply);
    if (!s) return;
    await db.delete(sessions).where(eq(sessions.id, s.sessionId));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/me/sessions/:id", async (req, reply) => {
    const s = await requireSession(db, req, reply);
    if (!s) return;
    const id = Uuid.safeParse(req.params.id);
    if (!id.success) return reply.code(400).send({ error: "bad_request" });
    // Nur eigene Sitzungen; fremde Kennungen sehen aus wie unbekannte.
    const gone = await db.delete(sessions).where(and(eq(sessions.id, id.data), eq(sessions.userId, s.userId))).returning({ id: sessions.id });
    if (gone.length === 0) return reply.code(404).send({ error: "not_found" });
    hub.disconnectSession(id.data);
    req.log.info({ userId: s.userId, sessionId: id.data }, "Sitzung abgemeldet");
    return { ok: true };
  });
}
