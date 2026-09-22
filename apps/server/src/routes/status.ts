import { displayNameOf, type ServerStatus, type StatusChannel, type StatusMember } from "@squorli/protocol";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config";
import type { Db } from "../db";
import { members, serverSettings, users } from "../db/schema";
import type { Hub } from "../hub";
import { SETTINGS_ID, loadCategories, loadChannels, loadSettings } from "../state";
import type { VoicePresence } from "../voice/presence";

/** One answer serves every request of the same moment: a widget on a busy page must not turn into a query per visitor. */
const CACHE_MS = 1000;

/**
 * Status API (docs/features/status-api.md): GET /api/status shows the server, its channels and where the members sit to
 * the outside (a website widget, a bot, a stream overlay). Off by default (404). The admin chooses in Verwaltung > Server
 * whether the server's key is needed (`Authorization: Bearer <key>` or `?key=<key>`, 401 otherwise) or anyone may read it.
 * No permissions, roles, keys or messages leave the server this way.
 */
export async function registerStatusRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence, config: Config) {
  let cached: { at: number; status: ServerStatus } | null = null;
  const build = async (): Promise<ServerStatus> => {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.status;
    const [settings, categories, channels, rows] = await Promise.all([
      loadSettings(db), loadCategories(db), loadChannels(db),
      db.select({ userId: members.userId, isOwner: members.isOwner, publicKey: users.publicKey, displayName: users.displayName, handle: users.handle, avatarUrl: users.avatarUrl })
        .from(members).innerJoin(users, eq(users.id, members.userId)).orderBy(asc(members.joinedAt)),
    ]);
    const statusMembers: StatusMember[] = rows.map((r) => {
      const seat = presence.statusOfUser(r.userId);
      return {
        userId: r.userId, displayName: displayNameOf(r), handle: r.handle,
        // The directory account's picture, public there like the handle (user's decision: no extra consent for it).
        avatarUrl: r.avatarUrl,
        online: hub.isOnline(r.userId), afk: hub.isAfk(r.userId), isOwner: settings.ownerId === r.userId || r.isOwner,
        voice: seat ?? null,
      };
    });
    const statusChannels: StatusChannel[] = channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, topic: c.topic, categoryId: c.categoryId, position: c.position }));
    const status: ServerStatus = {
      name: settings.name, iconUrl: settings.iconUrl ? `${config.publicOrigin}${settings.iconUrl}` : null, time: new Date().toISOString(),
      categories, channels: statusChannels, members: statusMembers,
    };
    cached = { at: Date.now(), status };
    return status;
  };

  app.get("/api/status", async (req, reply) => {
    const [row] = await db.select({ mode: serverSettings.statusApi, key: serverSettings.statusApiKey }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
    reply.header("cache-control", "no-store");
    if (!row || row.mode === "off") return reply.code(404).send({ error: "status_api_off" });
    if (row.mode === "key" && !keyMatches(req, row.key)) return reply.code(401).send({ error: "unauthorized" });
    const status = await build();
    // `?online=1`: only members who are signed in right now (a widget that lists who is there).
    const onlineOnly = (req.query as { online?: string }).online;
    return onlineOnly === "1" || onlineOnly === "true" ? { ...status, members: status.members.filter((m) => m.online) } : status;
  });
}

/** The key from the Authorization header or the query string, compared in constant time. */
function keyMatches(req: FastifyRequest, key: string | null): boolean {
  if (!key) return false;
  const auth = req.headers.authorization;
  const given = auth?.startsWith("Bearer ") ? auth.slice(7) : (req.query as { key?: string }).key;
  if (typeof given !== "string") return false;
  const a = Buffer.from(given), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
