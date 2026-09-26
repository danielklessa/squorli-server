import { MOD_LOG_DAYS, type ModLogAction, type ModLogEntry, type ModLogResponse } from "@squorli/protocol";
import { desc, eq, lt } from "drizzle-orm";
import { displayNameOf } from "@squorli/protocol";
import { localAccounts, users } from "./db/schema";
import { localJoin, nameColumns } from "./names";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "./db";
import { modLog } from "./db/schema";

/**
 * The moderation log (docs/features/reports.md; decision 2 of 25 September 2026): one row per moderation action, without
 * message contents, readable with MANAGE_REPORTS, kept MOD_LOG_DAYS. Written by the routes that act (messages, members,
 * channel blocks, reports); never by the vote kick, which is the members' own doing.
 */
export type ModLogInput = {
  actorId: string | null; actorName: string;
  targetUserId?: string | null; targetName?: string | null;
  action: ModLogAction;
  channelId?: string | null; channelName?: string | null;
  detail?: Record<string, unknown>;
};

export async function recordModLog(db: Db, e: ModLogInput, log?: FastifyBaseLogger): Promise<void> {
  try {
    await db.insert(modLog).values({
      actorId: e.actorId, actorName: e.actorName, targetUserId: e.targetUserId ?? null, targetName: e.targetName ?? null,
      action: e.action, channelId: e.channelId ?? null, channelName: e.channelName ?? null, detail: e.detail ?? {},
    });
  } catch (err) {
    // The action itself already happened; a log line that cannot be written must not undo it.
    log?.warn({ err, action: e.action }, "Moderationslog nicht geschrieben");
  }
}

/** Newest first; `before` = the `at` of the last entry the client has. */
export async function listModLog(db: Db, before: Date | null, limit = 100): Promise<ModLogResponse> {
  const rows = await db.select().from(modLog).where(before ? lt(modLog.at, before) : undefined).orderBy(desc(modLog.at)).limit(limit + 1);
  const entries: ModLogEntry[] = rows.slice(0, limit).map((r) => ({
    id: r.id, at: r.at.toISOString(), actorId: r.actorId, actorName: r.actorName, targetUserId: r.targetUserId, targetName: r.targetName,
    action: r.action as ModLogEntry["action"], channelId: r.channelId, channelName: r.channelName, detail: r.detail,
  }));
  return { entries, hasMore: rows.length > limit };
}

export async function sweepModLog(db: Db): Promise<number> {
  const gone = await db.delete(modLog).where(lt(modLog.at, new Date(Date.now() - MOD_LOG_DAYS * 86_400_000))).returning({ id: modLog.id });
  return gone.length;
}

/** For tests and callers that only need to know whether an entry exists. */
export async function lastModLogEntry(db: Db): Promise<ModLogEntry | null> {
  const r = await listModLog(db, null, 1);
  return r.entries[0] ?? null;
}

/** A user's shown name for a log line (the log keeps names as text, so it stays readable after the account is gone). */
export async function userNameOf(db: Db, userId: string): Promise<string | null> {
  const [u] = await db.select(nameColumns).from(users).leftJoin(localAccounts, localJoin).where(eq(users.id, userId)).limit(1);
  return u ? displayNameOf(u) : null;
}
