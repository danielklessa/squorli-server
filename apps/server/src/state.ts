import { displayNameOf, type Category, type Channel, type Member, type Role, type ServerSettings, type ServerState, Permission } from "@squorli/protocol";
import { asc, eq, inArray } from "drizzle-orm";
import { effectivePermissions, type Actor } from "./authz";
import type { Db } from "./db";
import { categories, channels, memberRoles, members, roles, serverSettings, users } from "./db/schema";
import type { Hub } from "./hub";

export const SETTINGS_ID = "server";

/** REQUIRE_ACCOUNT from the configuration: null = the admin area decides, otherwise pinned (index.ts sets it at startup). */
let requireAccountForced: boolean | null = null;
export function setRequireAccountForced(v: boolean | null): void { requireAccountForced = v; }

export async function loadSettings(db: Db): Promise<ServerSettings> {
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
  if (!row) throw new Error("server_settings fehlt (Bootstrap nicht gelaufen)");
  return {
    name: row.name, openJoin: row.openJoin, ownerId: row.ownerId,
    requireAccount: requireAccountForced ?? row.requireAccount, requireAccountLocked: requireAccountForced !== null,
    listed: row.listed, description: row.description,
    iconUrl: row.iconMime && row.iconUpdatedAt ? `/api/server-icon?v=${row.iconUpdatedAt.getTime()}` : null,
  };
}

export async function loadCategories(db: Db): Promise<Category[]> {
  return db.select().from(categories).orderBy(asc(categories.position), asc(categories.name));
}

export async function loadChannels(db: Db): Promise<Channel[]> {
  const rows = await db.select().from(channels).orderBy(asc(channels.position), asc(channels.createdAt));
  return rows.map((c) => ({ id: c.id, kind: c.kind, name: c.name, topic: c.topic, categoryId: c.categoryId, position: c.position, audioBitrate: c.audioBitrate, audioStereo: c.audioStereo }));
}

export async function loadRoles(db: Db): Promise<Role[]> {
  const rows = await db.select().from(roles).orderBy(asc(roles.position), asc(roles.name));
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, permissions: r.permissions, position: r.position, isDefault: r.isDefault }));
}

export async function loadMembers(db: Db, hub: Hub): Promise<Member[]> {
  const rows = await db
    .select({ userId: members.userId, joinedAt: members.joinedAt, streamBlocked: members.streamBlocked, isOwner: members.isOwner, publicKey: users.publicKey, displayName: users.displayName, handle: users.handle })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .orderBy(asc(members.joinedAt));
  const links = rows.length
    ? await db.select().from(memberRoles).where(inArray(memberRoles.userId, rows.map((r) => r.userId)))
    : [];
  const byUser = new Map<string, string[]>();
  for (const l of links) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l.roleId]);
  return rows.map((r) => ({
    userId: r.userId,
    displayName: displayNameOf(r),
    publicKey: r.publicKey,
    roleIds: byUser.get(r.userId) ?? [],
    joinedAt: r.joinedAt.toISOString(),
    online: hub.isOnline(r.userId),
    streamBlocked: r.streamBlocked,
    handle: r.handle,
    isOwner: r.isOwner,
  }));
}

/** Permission context of a user; null = not a member. */
export async function actorOf(db: Db, userId: string): Promise<Actor | null> {
  const [m] = await db.select({ userId: members.userId, streamBlocked: members.streamBlocked, isOwner: members.isOwner }).from(members).where(eq(members.userId, userId)).limit(1);
  if (!m) return null;
  const settings = await loadSettings(db);
  // The first owner via server_settings, further ones via members.is_owner (bootstrap reconciles both).
  const isOwner = settings.ownerId === userId || m.isOwner;
  const mine = await db
    .select({ permissions: roles.permissions, position: roles.position })
    .from(memberRoles)
    .innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .where(eq(memberRoles.userId, userId));
  const [def] = await db.select({ permissions: roles.permissions, position: roles.position }).from(roles).where(eq(roles.isDefault, true)).limit(1);
  const all = def ? [...mine, def] : mine;
  return {
    userId,
    isOwner,
    // A moderator's streaming block removes STREAM_VIDEO regardless of roles (owners exempt).
    permissions: effectivePermissions(isOwner, all.map((r) => r.permissions)) & (m.streamBlocked && !isOwner ? ~Permission.STREAM_VIDEO : ~0),
    topPosition: isOwner ? Number.MAX_SAFE_INTEGER : Math.max(0, ...all.map((r) => r.position)),
  };
}

export async function loadState(db: Db, hub: Hub, userId: string): Promise<ServerState> {
  const [settings, cats, chans, rs, mems, actor] = await Promise.all([
    loadSettings(db), loadCategories(db), loadChannels(db), loadRoles(db), loadMembers(db, hub), actorOf(db, userId),
  ]);
  return { settings, categories: cats, channels: chans, roles: rs, members: mems, myPermissions: actor?.permissions ?? 0 };
}

export type StructurePart = "settings" | "categories" | "channels" | "roles" | "members";

/** After a change, send the affected part to everyone. For roles/members, additionally send each online user their permissions. */
export async function broadcastStructure(db: Db, hub: Hub, parts: StructurePart[]) {
  const e: Extract<import("@squorli/protocol").ServerEvent, { type: "structure" }> = { type: "structure" };
  for (const p of parts) {
    if (p === "settings") e.settings = await loadSettings(db);
    if (p === "categories") e.categories = await loadCategories(db);
    if (p === "channels") e.channels = await loadChannels(db);
    if (p === "roles") e.roles = await loadRoles(db);
    if (p === "members") e.members = await loadMembers(db, hub);
  }
  hub.broadcast(e);
  if (parts.includes("roles") || parts.includes("members") || parts.includes("settings")) {
    for (const userId of hub.onlineUserIds()) {
      const a = await actorOf(db, userId);
      hub.sendToUser(userId, { type: "me", myPermissions: a?.permissions ?? 0 });
    }
  }
}
