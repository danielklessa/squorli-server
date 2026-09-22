import { displayNameOf, twitchChannelOf, youtubeVideoOf, type Category, type Channel, type Member, type RadioStation, type Role, type ServerSettings, type ServerState, Permission } from "@squorli/protocol";
import { asc, eq, inArray } from "drizzle-orm";
import { effectivePermissions, type Actor } from "./authz";
import type { Db } from "./db";
import { categories, channels, memberRoles, members, radioStations, roles, serverSettings, users } from "./db/schema";
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
    listed: row.listed, description: row.description, radioAutoStop: row.radioAutoStop,
    afkChannelId: row.afkChannelId,
    iconUrl: row.iconMime && row.iconUpdatedAt ? `/api/server-icon?v=${row.iconUpdatedAt.getTime()}` : null,
  };
}

export async function loadCategories(db: Db): Promise<Category[]> {
  return db.select().from(categories).orderBy(asc(categories.position), asc(categories.name));
}

export async function loadChannels(db: Db): Promise<Channel[]> {
  const rows = await db.select({ c: channels, stationName: radioStations.name }).from(channels)
    .leftJoin(radioStations, eq(radioStations.id, channels.radioStationId))
    .orderBy(asc(channels.position), asc(channels.createdAt));
  return rows.map(({ c, stationName }) => ({
    id: c.id, kind: c.kind, name: c.name, topic: c.topic, categoryId: c.categoryId, position: c.position, audioBitrate: c.audioBitrate, audioStereo: c.audioStereo,
    // On while there is something to play. The name: the station's (current one), else the one stored for a typed address.
    radio: c.radioStreamUrl ? { stationId: stationName !== null ? c.radioStationId : null, name: stationName ?? c.radioName ?? radioHostOf(c.radioStreamUrl), streamUrl: c.radioStreamUrl, startedBy: c.radioStartedBy, twitchChannel: twitchChannelOf(c.radioStreamUrl), ...youtubeRadio(c.radioStreamUrl, c.radioPlayback), queue: c.radioQueue ? { listId: c.radioQueue.listId, index: c.radioQueue.index, length: c.radioQueue.videoIds.length } : null } : null,
  }));
}

/** A YouTube source carries its video and where that stands for everyone; a source without a stored state (none is written that way) waits at the beginning. */
function youtubeRadio(streamUrl: string, playback: { playing: boolean; position: number; rate: number; at: number } | null) {
  const video = youtubeVideoOf(streamUrl)?.videoId ?? null;
  return { youtubeVideo: video, playback: video ? playback ?? { playing: false, position: 0, rate: 1, at: 0 } : null };
}

/** Short name for an address without a station: its host. */
export function radioHostOf(url: string): string {
  const twitch = twitchChannelOf(url);
  if (twitch) return `twitch.tv/${twitch}`;
  const youtube = youtubeVideoOf(url);
  if (youtube) return `youtu.be/${youtube.videoId}`;
  try { return new URL(url).host; } catch { return url.slice(0, 64); }
}

export async function loadRadioStations(db: Db): Promise<RadioStation[]> {
  return db.select({ id: radioStations.id, name: radioStations.name, url: radioStations.url }).from(radioStations).orderBy(asc(radioStations.name), asc(radioStations.createdAt));
}

export async function loadRoles(db: Db): Promise<Role[]> {
  const rows = await db.select().from(roles).orderBy(asc(roles.position), asc(roles.name));
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, permissions: r.permissions, position: r.position, isDefault: r.isDefault }));
}

export async function loadMembers(db: Db, hub: Hub): Promise<Member[]> {
  const rows = await db
    .select({ userId: members.userId, joinedAt: members.joinedAt, streamBlocked: members.streamBlocked, isOwner: members.isOwner, publicKey: users.publicKey, displayName: users.displayName, handle: users.handle, avatarUrl: users.avatarUrl })
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
    afk: hub.isAfk(r.userId),
    game: hub.gameOf(r.userId),
    streamBlocked: r.streamBlocked,
    handle: r.handle,
    avatarUrl: r.avatarUrl,
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
  const [settings, cats, chans, rs, mems, stations, actor] = await Promise.all([
    loadSettings(db), loadCategories(db), loadChannels(db), loadRoles(db), loadMembers(db, hub), loadRadioStations(db), actorOf(db, userId),
  ]);
  // importSources: what the import routes (routes/import.ts) can read a structure from; the client shows the admin tab only for these.
  return { settings, categories: cats, channels: chans, roles: rs, members: mems, radioStations: stations, importSources: ["discord-template"], myPermissions: actor?.permissions ?? 0 };
}

export type StructurePart = "settings" | "categories" | "channels" | "roles" | "members" | "radioStations";

/** After a change, send the affected part to everyone. For roles/members, additionally send each online user their permissions. */
export async function broadcastStructure(db: Db, hub: Hub, parts: StructurePart[]) {
  const e: Extract<import("@squorli/protocol").ServerEvent, { type: "structure" }> = { type: "structure" };
  for (const p of parts) {
    if (p === "settings") e.settings = await loadSettings(db);
    if (p === "categories") e.categories = await loadCategories(db);
    if (p === "channels") e.channels = await loadChannels(db);
    if (p === "roles") e.roles = await loadRoles(db);
    if (p === "members") e.members = await loadMembers(db, hub);
    if (p === "radioStations") e.radioStations = await loadRadioStations(db);
  }
  hub.broadcast(e);
  if (parts.includes("roles") || parts.includes("members") || parts.includes("settings")) {
    for (const userId of hub.onlineUserIds()) {
      const a = await actorOf(db, userId);
      hub.sendToUser(userId, { type: "me", myPermissions: a?.permissions ?? 0 });
    }
  }
}
