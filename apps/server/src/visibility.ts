import { Permission, hasPermission } from "@squorli/protocol";
import { effectivePermissions, type Actor } from "./authz";
import { channelPermissions, defaultRolePermissions, markedPrivate as isMarkedPrivate, type Overwrite } from "./channelPermissions";
import type { Db } from "./db";
import { categories, categoryOverwrites, channelOverwrites, channels, memberRoles, members, roles, serverSettings } from "./db/schema";

/**
 * Who sees which channel (docs/features/channel-permissions.md, 23 September 2026). The guarantee everything here serves:
 * a channel, its name, its messages, its voice presence, its radio and its typing reach a socket only when that socket's
 * user resolves VIEW_CHANNELS in that channel.
 *
 * One snapshot of everything the resolution needs (roles, memberships, overwrites, channels, who is held where) is loaded
 * per structure version, never per user: `invalidate()` at the top of broadcastStructure() (that is where every change of
 * roles, members, channels, categories and overwrites already ends up) and in the few places that change a member's seat
 * or hold without a broadcast. A user's masks are pure bit arithmetic over that snapshot (channelPermissions.ts), cached
 * until the snapshot or the user's seat changes.
 *
 * Two additions to the pure resolution: the channel a member sits in (or was just moved to, voice/confine.ts) is always
 * visible to them, otherwise a member moved into a channel they may not see could not render it; and a member held by a
 * sticky channel with `stickyHideVoice` gets VIEW_CHANNELS removed from every other voice channel (text channels stay, so
 * they can still ask for help).
 */
export type PermissionContext = {
  version: number;
  ownerId: string | null;
  defaultRoleId: string | null;
  defaultRoleMask: number;
  roles: Map<string, { permissions: number; position: number }>;
  channels: { id: string; kind: "text" | "voice"; categoryId: string | null; sticky: boolean; stickyHideVoice: boolean; allowVideo: boolean; allowVoteKick: boolean }[];
  categoryIds: string[];
  byChannel: Map<string, Overwrite[]>;
  byCategory: Map<string, Overwrite[]>;
  members: Map<string, { isOwner: boolean; streamBlocked: boolean; roleIds: string[]; confinedChannelId: string | null }>;
  /** Channels the default role cannot see: what the status API leaves out, and the AFK channel guard. */
  privateChannels: Set<string>;
  privateCategories: Set<string>;
  /**
   * Channels an overwrite here or on their category takes `VIEW_CHANNELS` away from the default role: the lock in the
   * channel list (`Channel.private`). "Set to private", not "the default role happens not to see it" (user's rule,
   * 23 September 2026): a default role without `VIEW_CHANNELS` server-wide would otherwise lock every channel, and the
   * lock would no longer mean what the dialog's "Privat" switch means.
   */
  markedPrivate: Set<string>;
};

export type VisibilitySources = {
  /** The voice channel the user sits in (VoicePresence.channelOfUser). */
  seatOf: (userId: string) => string | undefined;
  /** A channel a moderator just moved the user to and they have not joined yet (voice/confine.ts). */
  grantOf: (userId: string) => string | undefined;
};

const VIEW = Permission.VIEW_CHANNELS;

export class Visibility {
  private version = 0;
  private ctx: PermissionContext | null = null;
  private loading: Promise<PermissionContext> | null = null;
  /** Per user: the masks and what they were computed from (snapshot version, seat, grant). */
  private readonly perUser = new Map<string, { key: string; masks: Map<string, number> }>();
  /** The last visible set sent to a user, so broadcastStructure() can leave the channel list out when nothing changed. */
  private readonly sent = new Map<string, string>();
  private sources: VisibilitySources = { seatOf: () => undefined, grantOf: () => undefined };

  /** index.ts hands in the voice presence and the move grants once they exist. */
  setSources(sources: VisibilitySources): void { this.sources = sources; }

  /** The snapshot is stale: reloaded by the next refresh(). Cached masks stay as a fallback for the synchronous checks until then. */
  invalidate(): void { this.version++; }

  /** The current snapshot, reloaded when stale. Every check that authorizes something awaits this first. */
  async refresh(db: Db): Promise<PermissionContext> {
    while (!this.ctx || this.ctx.version !== this.version) {
      if (!this.loading) {
        const version = this.version;
        this.loading = loadContext(db, version).finally(() => { this.loading = null; });
      }
      const ctx = await this.loading;
      if (ctx.version === this.version) this.ctx = ctx;
    }
    return this.ctx;
  }

  /** The snapshot as it is, possibly stale; null before the first refresh(). For display, never for a decision. */
  get current(): PermissionContext | null { return this.ctx; }

  /** The user's seat changed: their masks are computed afresh next time (the snapshot itself is unaffected). */
  forgetUser(userId: string): void { this.perUser.delete(userId); }

  /** The member is gone (kick, ban, account deleted). */
  dropUser(userId: string): void { this.perUser.delete(userId); this.sent.delete(userId); }

  /**
   * The user's permissions in every channel and category, by id. Synchronous over the current snapshot (refresh() first
   * where it matters); an empty map before the first refresh or for somebody who is not a member.
   */
  masksOf(userId: string): Map<string, number> {
    const ctx = this.ctx;
    if (!ctx) return new Map();
    const seat = this.sources.seatOf(userId) ?? "", grant = this.sources.grantOf(userId) ?? "";
    const key = `${ctx.version}:${seat}:${grant}`;
    const cached = this.perUser.get(userId);
    if (cached && cached.key === key) return cached.masks;
    const masks = computeMasks(ctx, userId, seat || null, grant || null);
    this.perUser.set(userId, { key, masks });
    return masks;
  }

  /** The permission context of a member out of the snapshot (what actorOf() reads from the database). */
  actorOf(userId: string): Actor | null { return this.ctx ? actorFrom(this.ctx, userId) : null; }

  /**
   * The member's permissions in one channel as the overwrites alone resolve them: without the seat exception, so the
   * eviction (livekit/sync.ts) can tell somebody who lost access from somebody a moderator placed there.
   */
  resolvedMask(userId: string, channelId: string): number {
    const ctx = this.ctx;
    const a = ctx ? actorFrom(ctx, userId) : null;
    const m = ctx?.members.get(userId);
    const c = ctx?.channels.find((x) => x.id === channelId);
    if (!ctx || !a || !m || !c) return 0;
    const mask = channelPermissions({ base: a.permissions, isOwner: a.isOwner, userId, roleIds: a.roleIds, defaultRoleId: ctx.defaultRoleId, categoryOverwrites: c.categoryId ? ctx.byCategory.get(c.categoryId) ?? [] : [], channelOverwrites: ctx.byChannel.get(c.id) ?? [] });
    return mask & (m.streamBlocked && !a.isOwner ? ~Permission.STREAM_VIDEO : ~0);
  }

  /** Synchronous check for the event fan-out (Hub.setVisibility): may this user receive events of this channel? */
  canSee(userId: string, channelId: string): boolean {
    return hasPermission(this.masksOf(userId).get(channelId) ?? 0, VIEW);
  }

  visibleIds(userId: string): string[] {
    return [...this.masksOf(userId)].filter(([, m]) => hasPermission(m, VIEW)).map(([id]) => id);
  }

  /** Has the user's visible set changed since the last time this said so? Remembers the new one. */
  changedSince(userId: string, masks: Map<string, number>): boolean {
    const now = [...masks].filter(([, m]) => hasPermission(m, VIEW)).map(([id]) => id).sort().join(",");
    const before = this.sent.get(userId);
    this.sent.set(userId, now);
    return before !== now;
  }

  /** Where a sticky channel holds the user right now (null = nowhere), with whether other voice channels are hidden meanwhile. */
  voiceLockOf(userId: string): { channelId: string; hideVoice: boolean } | null {
    const ctx = this.ctx;
    const m = ctx?.members.get(userId);
    if (!ctx || !m?.confinedChannelId) return null;
    const ch = ctx.channels.find((c) => c.id === m.confinedChannelId);
    if (!ch?.sticky) return null;
    if (hasPermission(this.masksOf(userId).get(ch.id) ?? 0, Permission.BYPASS_STICKY)) return null;
    return { channelId: ch.id, hideVoice: ch.stickyHideVoice };
  }
}

/** The one instance; index.ts binds the presence and the move grants to it. */
export const visibility = new Visibility();

function actorFrom(ctx: PermissionContext, userId: string): Actor | null {
  const m = ctx.members.get(userId);
  if (!m) return null;
  const isOwner = ctx.ownerId === userId || m.isOwner;
  const mine = m.roleIds.map((id) => ctx.roles.get(id)).filter((r): r is { permissions: number; position: number } => !!r);
  const def = ctx.defaultRoleId ? ctx.roles.get(ctx.defaultRoleId) : undefined;
  const all = def ? [...mine, def] : mine;
  const roleIds = ctx.defaultRoleId && !m.roleIds.includes(ctx.defaultRoleId) ? [...m.roleIds, ctx.defaultRoleId] : m.roleIds;
  return {
    userId, isOwner, roleIds,
    permissions: effectivePermissions(isOwner, all.map((r) => r.permissions)) & (m.streamBlocked && !isOwner ? ~Permission.STREAM_VIDEO : ~0),
    topPosition: isOwner ? Number.MAX_SAFE_INTEGER : Math.max(0, ...all.map((r) => r.position)),
  };
}

/**
 * What a member whose extra role is this one may see: the status API's viewpoint (docs/features/status-api.md). `roleId`
 * null (or a role that no longer exists) = the default role alone, i.e. a plain visitor. Everybody carries the default role,
 * so it is always in: the answer is what a real member with that role would find in their channel list. A role with
 * ADMINISTRATOR resolves to everything — that is the admin's choice, and the dialog says so.
 */
export function roleView(ctx: PermissionContext, roleId: string | null): { channels: Set<string>; categories: Set<string> } {
  const role = roleId ? ctx.roles.get(roleId) : undefined;
  const roleIds = [ctx.defaultRoleId, role ? roleId : null].filter((id): id is string => !!id);
  const common = { base: ctx.defaultRoleMask | (role?.permissions ?? 0), isOwner: false, userId: "", roleIds, defaultRoleId: ctx.defaultRoleId };
  const channels = new Set<string>(), categories = new Set<string>();
  for (const c of ctx.channels) {
    const mask = channelPermissions({ ...common, categoryOverwrites: c.categoryId ? ctx.byCategory.get(c.categoryId) ?? [] : [], channelOverwrites: ctx.byChannel.get(c.id) ?? [] });
    if (hasPermission(mask, VIEW)) channels.add(c.id);
  }
  for (const id of ctx.categoryIds) {
    if (hasPermission(channelPermissions({ ...common, categoryOverwrites: ctx.byCategory.get(id) ?? [], channelOverwrites: [] }), VIEW)) categories.add(id);
  }
  return { channels, categories };
}

function computeMasks(ctx: PermissionContext, userId: string, seat: string | null, grant: string | null): Map<string, number> {
  const masks = new Map<string, number>();
  const a = actorFrom(ctx, userId);
  const m = ctx.members.get(userId);
  if (!a || !m) return masks;
  const common = { base: a.permissions, isOwner: a.isOwner, userId, roleIds: a.roleIds, defaultRoleId: ctx.defaultRoleId };
  // A moderator's stream block holds in every channel: an overwrite cannot give STREAM_VIDEO back (owners exempt).
  const blocked = m.streamBlocked && !a.isOwner ? ~Permission.STREAM_VIDEO : ~0;
  for (const c of ctx.channels) {
    const mask = channelPermissions({ ...common, categoryOverwrites: c.categoryId ? ctx.byCategory.get(c.categoryId) ?? [] : [], channelOverwrites: ctx.byChannel.get(c.id) ?? [] });
    masks.set(c.id, mask & blocked);
  }
  for (const id of ctx.categoryIds) masks.set(id, channelPermissions({ ...common, categoryOverwrites: ctx.byCategory.get(id) ?? [], channelOverwrites: [] }));
  // The seat exception: the channel one sits in (or was just moved to, or is held by and has to get back to) is always
  // there, whatever the overwrites say.
  const held = m.confinedChannelId ? ctx.channels.find((c) => c.id === m.confinedChannelId) : undefined;
  for (const id of [seat, grant, held?.sticky ? held.id : null]) if (id && ctx.channels.some((c) => c.id === id)) masks.set(id, (masks.get(id) ?? 0) | VIEW | Permission.CONNECT_VOICE);
  // Held by a sticky channel that hides the other voice channels meanwhile.
  if (held?.sticky && held.stickyHideVoice && !hasPermission(masks.get(held.id) ?? 0, Permission.BYPASS_STICKY)) {
    for (const c of ctx.channels) if (c.kind === "voice" && c.id !== held.id) masks.set(c.id, (masks.get(c.id) ?? 0) & ~VIEW);
  }
  return masks;
}

async function loadContext(db: Db, version: number): Promise<PermissionContext> {
  const [settingsRows, roleRows, memberRows, linkRows, channelRows, categoryRows, chanOw, catOw] = await Promise.all([
    db.select({ ownerId: serverSettings.ownerId }).from(serverSettings).limit(1),
    db.select({ id: roles.id, permissions: roles.permissions, position: roles.position, isDefault: roles.isDefault }).from(roles),
    db.select({ userId: members.userId, isOwner: members.isOwner, streamBlocked: members.streamBlocked, confinedChannelId: members.confinedChannelId }).from(members),
    db.select().from(memberRoles),
    db.select({ id: channels.id, kind: channels.kind, categoryId: channels.categoryId, sticky: channels.sticky, stickyHideVoice: channels.stickyHideVoice, allowVideo: channels.allowVideo, allowVoteKick: channels.allowVoteKick }).from(channels),
    db.select({ id: categories.id }).from(categories),
    db.select().from(channelOverwrites),
    db.select().from(categoryOverwrites),
  ]);
  const def = roleRows.find((r) => r.isDefault);
  const rolesById = new Map(roleRows.map((r) => [r.id, { permissions: r.permissions, position: r.position }]));
  const membersById = new Map(memberRows.map((r) => [r.userId, { isOwner: r.isOwner, streamBlocked: r.streamBlocked, roleIds: [] as string[], confinedChannelId: r.confinedChannelId }]));
  for (const l of linkRows) membersById.get(l.userId)?.roleIds.push(l.roleId);
  const group = <T extends { roleId: string | null; userId: string | null; allow: number; deny: number }>(rows: T[], keyOf: (r: T) => string) => {
    const out = new Map<string, Overwrite[]>();
    for (const r of rows) out.set(keyOf(r), [...(out.get(keyOf(r)) ?? []), { roleId: r.roleId, userId: r.userId, allow: r.allow, deny: r.deny }]);
    return out;
  };
  const byChannel = group(chanOw, (r) => r.channelId), byCategory = group(catOw, (r) => r.categoryId);
  const privateChannels = new Set<string>(), privateCategories = new Set<string>(), markedPrivate = new Set<string>();
  for (const c of channelRows) {
    const cat = c.categoryId ? byCategory.get(c.categoryId) ?? [] : [], own = byChannel.get(c.id) ?? [];
    if (!hasPermission(defaultRolePermissions(def?.id ?? null, def?.permissions ?? 0, cat, own), VIEW)) privateChannels.add(c.id);
    // The lock means "set to private here or on the category": resolve from a default role that may see everything, so only
    // the overwrites can take it away (a role without VIEW_CHANNELS server-wide is a role matter, not a channel's).
    if (isMarkedPrivate(def?.id ?? null, def?.permissions ?? 0, cat, own)) markedPrivate.add(c.id);
  }
  for (const k of categoryRows) if (!hasPermission(defaultRolePermissions(def?.id ?? null, def?.permissions ?? 0, byCategory.get(k.id) ?? [], []), VIEW)) privateCategories.add(k.id);
  return {
    version, ownerId: settingsRows[0]?.ownerId ?? null, defaultRoleId: def?.id ?? null, defaultRoleMask: def?.permissions ?? 0,
    roles: rolesById, channels: channelRows, categoryIds: categoryRows.map((c) => c.id), byChannel, byCategory, members: membersById, privateChannels, privateCategories, markedPrivate,
  };
}

