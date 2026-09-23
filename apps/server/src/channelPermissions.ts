import { CHANNEL_OVERRIDABLE, Permission, hasPermission } from "@squorli/protocol";

/**
 * Resolving a member's permissions in one channel (docs/features/channel-permissions.md, 23 September 2026). Pure and
 * without a database, so it stays testable; visibility.ts feeds it once per user and channel from a snapshot. Not in
 * authz.ts: that module is the hierarchy (rank, grant, outrank), this one is the resolution, with another input shape.
 *
 * Order, the same as Discord's (imported overwrites must mean the same thing): start from the server-wide mask of the
 * roles; then for the category and after it for the channel: the default role's deny, its allow, the union of the denies
 * of the member's other roles, the union of their allows, the member's own deny, their allow. A bit in neither mask is
 * neutral and inherits. The client mirrors this in apps/web/src/channelPerms.ts: whoever changes one changes both.
 */
export type Overwrite = { roleId: string | null; userId: string | null; allow: number; deny: number };

export type ChannelResolveInput = {
  /** The member's server-wide permissions (Actor.permissions: roles, owner, minus the stream block). */
  base: number;
  isOwner: boolean;
  userId: string;
  /** Every role the member holds, the default role included. */
  roleIds: readonly string[];
  defaultRoleId: string | null;
  /** [] when the channel is outside every category. */
  categoryOverwrites: readonly Overwrite[];
  channelOverwrites: readonly Overwrite[];
};

export function channelPermissions(i: ChannelResolveInput): number {
  // An owner or administrator sees and may do everything everywhere (user's decision: nobody else bypasses a private
  // channel), and can therefore never lock themselves out.
  if (i.isOwner || hasPermission(i.base, Permission.ADMINISTRATOR)) return Permission.ADMINISTRATOR;
  let mask = i.base;
  mask = apply(mask, i.categoryOverwrites, i);
  mask = apply(mask, i.channelOverwrites, i);
  return mask;
}

function apply(mask: number, ows: readonly Overwrite[], i: ChannelResolveInput): number {
  const everyone = i.defaultRoleId ? ows.find((o) => o.roleId === i.defaultRoleId) : undefined;
  if (everyone) mask = (mask & ~(everyone.deny & CHANNEL_OVERRIDABLE)) | (everyone.allow & CHANNEL_OVERRIDABLE);
  let allow = 0, deny = 0;
  for (const o of ows) if (o.roleId && o.roleId !== i.defaultRoleId && i.roleIds.includes(o.roleId)) { allow |= o.allow; deny |= o.deny; }
  mask = (mask & ~(deny & CHANNEL_OVERRIDABLE)) | (allow & CHANNEL_OVERRIDABLE);
  const mine = ows.find((o) => o.userId === i.userId);
  if (mine) mask = (mask & ~(mine.deny & CHANNEL_OVERRIDABLE)) | (mine.allow & CHANNEL_OVERRIDABLE);
  return mask;
}

/** What the default role resolves to in a channel: the status API and the AFK channel guard leave out what it cannot see. */
export function defaultRolePermissions(defaultRoleId: string | null, defaultRoleMask: number, categoryOverwrites: readonly Overwrite[], channelOverwrites: readonly Overwrite[]): number {
  return channelPermissions({ base: defaultRoleMask, isOwner: false, userId: "", roleIds: defaultRoleId ? [defaultRoleId] : [], defaultRoleId, categoryOverwrites, channelOverwrites });
}

/**
 * Is the channel *set to private* — here or on its category? That is what the lock in the channel list means
 * (`Channel.private`, user's rule of 23 September 2026), and it is narrower than "the default role cannot see it":
 * the resolution starts from a default role that may see everything, so only an overwrite can take the sight away.
 * A default role without `VIEW_CHANNELS` server-wide is a role matter and locks no channel; a category deny that the
 * channel allows again is no lock either.
 */
export function markedPrivate(defaultRoleId: string | null, defaultRoleMask: number, categoryOverwrites: readonly Overwrite[], channelOverwrites: readonly Overwrite[]): boolean {
  return !hasPermission(defaultRolePermissions(defaultRoleId, defaultRoleMask | Permission.VIEW_CHANNELS, categoryOverwrites, channelOverwrites), Permission.VIEW_CHANNELS);
}
