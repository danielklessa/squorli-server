import { displayNameOf, type ServerStatus, type StatusChannel, type StatusMember } from "@squorli/protocol";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config";
import type { Db } from "../db";
import { localAccounts, members, serverSettings, users } from "../db/schema";
import type { Hub } from "../hub";
import { SETTINGS_ID, loadCategories, loadChannels, loadSettings } from "../state";
import { roleView, visibility } from "../visibility";
import type { VoicePresence } from "../voice/presence";
import { avatarOf } from "../names";

/** One answer serves every request of the same moment: a widget on a busy page must not turn into a query per visitor. */
const CACHE_MS = 1000;

/**
 * Status API (docs/features/status-api.md): GET /api/status shows the server, its channels and who sits in a voice channel
 * to the outside (a website widget, a bot, a stream overlay). Off by default (404). The admin chooses in Verwaltung > Server
 * whether the server's key is needed (`Authorization: Bearer <key>` or `?key=<key>`, 401 otherwise) or anyone may read it.
 * Only members in a voice channel are listed (user's decision of 23 September 2026: the rest of the member list stays inside);
 * no permissions, roles, keys or messages leave the server this way.
 */
export async function registerStatusRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence, config: Config) {
  // The viewpoint belongs in the cache key: switching the role in the admin area must show at once, not a second later.
  // A permission change still has the one-second window, which is what the cache is for (docs/features/status-api.md).
  let cached: { at: number; roleId: string | null; status: ServerStatus } | null = null;
  const build = async (roleId: string | null): Promise<ServerStatus> => {
    if (cached && cached.roleId === roleId && Date.now() - cached.at < CACHE_MS) return cached.status;
    // Private channels (docs/features/channel-permissions.md): the outside gets what one role would see, in both modes (the
    // key reads, it is no membership), and nobody sitting in a channel that role may not see. Which role is the admin's
    // choice (`statusApiRoleId`, user's wish of 23 September 2026); null = the default role, i.e. a plain visitor.
    const [settings, allCategories, allChannels, rows, ctx] = await Promise.all([
      loadSettings(db), loadCategories(db), loadChannels(db),
      db.select({ userId: members.userId, isOwner: members.isOwner, publicKey: users.publicKey, displayName: users.displayName, handle: users.handle, avatarUrl: users.avatarUrl, localHandle: localAccounts.handle, localAvatarAt: localAccounts.avatarUpdatedAt })
        .from(members).innerJoin(users, eq(users.id, members.userId)).leftJoin(localAccounts, eq(localAccounts.userId, members.userId)).orderBy(asc(members.joinedAt)),
      visibility.refresh(db),
    ]);
    const view = roleView(ctx, roleId);
    const categories = allCategories.filter((k) => view.categories.has(k.id));
    const channels = allChannels.filter((c) => view.channels.has(c.id));
    const statusMembers: StatusMember[] = [];
    for (const r of rows) {
      const seat = presence.statusOfUser(r.userId);
      if (!seat || !view.channels.has(seat.channelId)) continue;
      statusMembers.push({
        userId: r.userId, displayName: displayNameOf(r), handle: r.handle, localHandle: r.localHandle,
        // The directory account's picture, public there like the handle (user's decision: no extra consent for it).
        avatarUrl: avatarOf(r),
        afk: hub.isAfk(r.userId), isOwner: settings.ownerId === r.userId || r.isOwner,
        voice: seat,
      });
    }
    const statusChannels: StatusChannel[] = channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, topic: c.topic, categoryId: c.categoryId, position: c.position }));
    const status: ServerStatus = {
      name: settings.name, iconUrl: settings.iconUrl ? `${config.publicOrigin}${settings.iconUrl}` : null, time: new Date().toISOString(),
      categories, channels: statusChannels, members: statusMembers,
    };
    cached = { at: Date.now(), roleId, status };
    return status;
  };

  app.get("/api/status", async (req, reply) => {
    const [row] = await db.select({ mode: serverSettings.statusApi, key: serverSettings.statusApiKey, roleId: serverSettings.statusApiRoleId }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
    reply.header("cache-control", "no-store");
    if (!row || row.mode === "off") return reply.code(404).send({ error: "status_api_off" });
    if (row.mode === "key" && !keyMatches(req, row.key)) return reply.code(401).send({ error: "unauthorized" });
    return build(row.roleId);
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
