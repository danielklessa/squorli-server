import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Actor } from "../authz";
import type { Db } from "../db";
import { localAccounts, sessions, users } from "../db/schema";
import { actorOf } from "../state";

export type SessionUser = { userId: string; sessionId: string; publicKey: string; displayName: string | null; handle: string | null; handleCheckedAt: Date | null; avatarUrl: string | null; localHandle: string | null; localAvatarAt: Date | null };

/** Write last_used_at at most every 5 minutes (device list, M6c); not on every request. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Used by the WS handshake and by protected routes. Returns the user behind a session token. */
export async function resolveSession(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ userId: sessions.userId, sessionId: sessions.id, expiresAt: sessions.expiresAt, lastUsedAt: sessions.lastUsedAt, publicKey: users.publicKey, displayName: users.displayName, handle: users.handle, handleCheckedAt: users.handleCheckedAt, avatarUrl: users.avatarUrl, localHandle: localAccounts.handle, localAvatarAt: localAccounts.avatarUpdatedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(localAccounts, eq(localAccounts.userId, sessions.userId))
    .where(eq(sessions.token, token))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    void db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.token, token)).catch(() => { /* display only, no reason to abort */ });
  }
  return { userId: row.userId, sessionId: row.sessionId, publicKey: row.publicKey, displayName: row.displayName, handle: row.handle, handleCheckedAt: row.handleCheckedAt, avatarUrl: row.avatarUrl, localHandle: row.localHandle, localAvatarAt: row.localAvatarAt };
}

function bearer(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Bearer token from the Authorization header; sends a 401 itself if nothing valid is present. */
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

/** WebSocket close code for a member who must register before connecting (docs/features/local-accounts.md). */
export const CLOSE_REGISTRATION_REQUIRED = 4013;

/** No temporary users (docs/features/local-accounts.md): a key needs a directory handle or a server account. */
export const hasAccount = (u: { handle: string | null; localHandle: string | null }) => !!u.handle || !!u.localHandle;

/**
 * Like requireSession, plus membership and permissions. 403 not_member if kicked/banned, 403 registration_required for a member
 * from before server accounts who has no account yet (only GET /api/me and POST /api/local/claim work for them).
 */
export async function requireMember(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<MemberContext | null> {
  const s = await requireSession(db, req, reply);
  if (!s) return null;
  if (!hasAccount(s)) {
    await reply.code(403).send({ error: "registration_required" });
    return null;
  }
  const actor = await actorOf(db, s.userId);
  if (!actor) {
    await reply.code(403).send({ error: "not_member" });
    return null;
  }
  return { ...s, actor };
}
