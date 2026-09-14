import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Actor } from "../authz";
import type { Db } from "../db";
import { sessions, users } from "../db/schema";
import { actorOf } from "../state";

export type SessionUser = { userId: string; sessionId: string; publicKey: string; displayName: string | null; handle: string | null };

/** last_used_at hoechstens alle 5 Minuten schreiben (Geraeteliste, M6c); nicht auf jeder Anfrage. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Wird von WS-Handshake und geschuetzten Routen genutzt. Liefert den Nutzer hinter einem Session-Token. */
export async function resolveSession(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ userId: sessions.userId, sessionId: sessions.id, expiresAt: sessions.expiresAt, lastUsedAt: sessions.lastUsedAt, publicKey: users.publicKey, displayName: users.displayName, handle: users.handle })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.token, token))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    void db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.token, token)).catch(() => { /* nur Anzeige, kein Grund zum Abbruch */ });
  }
  return { userId: row.userId, sessionId: row.sessionId, publicKey: row.publicKey, displayName: row.displayName, handle: row.handle };
}

function bearer(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Bearer-Token aus dem Authorization-Header; antwortet selbst mit 401, wenn nichts Gueltiges da ist. */
export async function requireSession(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const token = bearer(req);
  const session = token ? await resolveSession(db, token) : null;
  if (!session) {
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return session;
}

export type MemberContext = SessionUser & { actor: Actor };

/** Wie requireSession, zusaetzlich Mitgliedschaft und Rechte. 403 not_member, wenn gekickt/gebannt. */
export async function requireMember(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<MemberContext | null> {
  const s = await requireSession(db, req, reply);
  if (!s) return null;
  const actor = await actorOf(db, s.userId);
  if (!actor) {
    await reply.code(403).send({ error: "not_member" });
    return null;
  }
  return { ...s, actor };
}
