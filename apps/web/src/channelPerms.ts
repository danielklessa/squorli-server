import { CHANNEL_OVERRIDABLE, Permission, hasPermission, type Channel, type ChannelNotification, type PermissionName, type PermissionOverwrite, type Role } from "@squorli/protocol";

/**
 * Channel permissions on the client (docs/features/channel-permissions.md), the pure part: what the dialog shows and
 * writes, and the preview "what does this entry resolve to" without a round trip. The resolution mirrors
 * apps/server/src/channelPermissions.ts: whoever changes one changes both. The server stays the authority; this only
 * draws and offers.
 */
export type OverwriteState = "allow" | "neutral" | "deny";

/** What an entry says about one permission. */
export function overwriteState(o: { allow: number; deny: number }, perm: number): OverwriteState {
  if ((o.allow & perm) === perm) return "allow";
  if ((o.deny & perm) === perm) return "deny";
  return "neutral";
}

/** The entry with one permission set to a state; a bit is never in both masks. */
export function setOverwriteState<T extends { allow: number; deny: number }>(o: T, perm: number, state: OverwriteState): T {
  const allow = o.allow & ~perm, deny = o.deny & ~perm;
  return { ...o, allow: state === "allow" ? allow | perm : allow, deny: state === "deny" ? deny | perm : deny };
}

/** An entry that says nothing any more can go. */
export const emptyOverwrite = (o: { allow: number; deny: number }) => o.allow === 0 && o.deny === 0;

export type Subject = { userId: string; isOwner: boolean; base: number; roleIds: readonly string[] };

/**
 * The permissions `s` resolves to in a channel: the roles' server-wide mask, then the category's entries, then the
 * channel's, each in the order everyone -> roles (deny, allow) -> the member (deny, allow). The same as the server.
 */
export function resolveIn(s: Subject, defaultRoleId: string | null, categoryOverwrites: readonly PermissionOverwrite[], channelOverwrites: readonly PermissionOverwrite[]): number {
  if (s.isOwner || hasPermission(s.base, Permission.ADMINISTRATOR)) return Permission.ADMINISTRATOR;
  let mask = s.base;
  for (const ows of [categoryOverwrites, channelOverwrites]) {
    const everyone = defaultRoleId ? ows.find((o) => o.targetType === "role" && o.targetId === defaultRoleId) : undefined;
    if (everyone) mask = (mask & ~(everyone.deny & CHANNEL_OVERRIDABLE)) | (everyone.allow & CHANNEL_OVERRIDABLE);
    let allow = 0, deny = 0;
    for (const o of ows) if (o.targetType === "role" && o.targetId !== defaultRoleId && s.roleIds.includes(o.targetId)) { allow |= o.allow; deny |= o.deny; }
    mask = (mask & ~(deny & CHANNEL_OVERRIDABLE)) | (allow & CHANNEL_OVERRIDABLE);
    const mine = ows.find((o) => o.targetType === "member" && o.targetId === s.userId);
    if (mine) mask = (mask & ~(mine.deny & CHANNEL_OVERRIDABLE)) | (mine.allow & CHANNEL_OVERRIDABLE);
  }
  return mask;
}

/** The server-wide mask of a set of roles (the default role included), as actorOf() on the server computes it. */
export function baseOf(roleIds: readonly string[], roles: readonly Role[]): number {
  const def = roles.find((r) => r.isDefault);
  return roles.filter((r) => roleIds.includes(r.id) || r.id === def?.id).reduce((m, r) => m | r.permissions, 0);
}

/**
 * Where a neutral entry gets its value from, for the hint next to the "inherits" state: the category's entry for the same
 * target, else the roles' server-wide mask ("server"). Only the same target is looked at (a role's own line inherits from
 * that role's category line), which is what a person editing one line expects to read.
 */
export function inheritedFrom(target: { targetType: "role" | "member"; targetId: string }, perm: number, categoryOverwrites: readonly PermissionOverwrite[], serverMask: number): { state: "allow" | "deny"; source: "category" | "server" } {
  const cat = categoryOverwrites.find((o) => o.targetType === target.targetType && o.targetId === target.targetId);
  if (cat) {
    const s = overwriteState(cat, perm);
    if (s !== "neutral") return { state: s, source: "category" };
  }
  return { state: hasPermission(serverMask, perm) ? "allow" : "deny", source: "server" };
}

/** Only what one holds oneself in the channel may be handed out (the server's cannot_grant). */
export const grantableIn = (myMaskInChannel: number, perm: number) => hasPermission(myMaskInChannel, perm);

// ---- The shortcuts: one mechanism (an entry for the default role), several switches (docs/features/channel-permissions.md).

const entryOf = (list: readonly PermissionOverwrite[], roleId: string) => list.find((o) => o.targetType === "role" && o.targetId === roleId);

/** Does the default role's entry deny `perm` here? (The switch is on.) */
export function everyoneDenies(list: readonly PermissionOverwrite[], defaultRoleId: string | null, perm: number): boolean {
  const e = defaultRoleId ? entryOf(list, defaultRoleId) : undefined;
  return !!e && (e.deny & perm) === perm;
}

/**
 * The list with the default role's deny of `perm` set or cleared. Turning "private" on also allows the editor themselves
 * to see it (`keepFor`), so nobody locks themselves out; the server refuses such a list anyway (would_lock_out).
 */
export function withEveryoneDeny(list: readonly PermissionOverwrite[], defaultRoleId: string, perm: number, on: boolean, keepFor: string | null = null): PermissionOverwrite[] {
  let out = list.map((o) => (o.targetType === "role" && o.targetId === defaultRoleId ? setOverwriteState(o, perm, on ? "deny" : "neutral") : o));
  if (on && !entryOf(out, defaultRoleId)) out = [...out, { targetType: "role", targetId: defaultRoleId, allow: 0, deny: perm }];
  if (on && keepFor) {
    const mine = out.find((o) => o.targetType === "member" && o.targetId === keepFor);
    if (mine) out = out.map((o) => (o === mine ? setOverwriteState(o, perm, "allow") : o));
    else out = [...out, { targetType: "member", targetId: keepFor, allow: perm, deny: 0 }];
  }
  return out.filter((o) => !emptyOverwrite(o));
}

/** The shortcuts the dialog offers as one switch each, with the bits they stand for. */
export const SHORTCUTS = {
  private: Permission.VIEW_CHANNELS,
  readOnly: Permission.SEND_MESSAGES | Permission.ATTACH_FILES,
} as const;

// ---- Slowmode

/** Seconds the member still has to wait (0 = may send). */
export function slowmodeRemaining(now: number, lastSentAt: number | null, seconds: number): number {
  if (seconds <= 0 || lastSentAt === null) return 0;
  return Math.max(0, Math.ceil((lastSentAt + seconds * 1000 - now) / 1000));
}

/** The steps the dialog offers. */
export const SLOWMODE_STEPS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 3600] as const;

/** "5 s", "2 min", "1 h": the unit that fits. */
export function slowmodeLabel(seconds: number, units: { s: string; min: string; h: string }): string {
  if (seconds >= 3600) return `${seconds / 3600} ${units.h}`;
  if (seconds >= 60) return `${seconds / 60} ${units.min}`;
  return `${seconds} ${units.s}`;
}

// ---- Notifications: the channel suggests, the member's own mute wins.

export function effectiveNotify(channelDefault: ChannelNotification, mutedByMe: boolean | null): ChannelNotification {
  if (mutedByMe === true) return "mentions";
  if (mutedByMe === false) return "all";
  return channelDefault;
}

/** The permissions of a channel of this kind that the dialog lists, in the protocol's group order. */
export function permissionsFor(kind: Channel["kind"] | "category", groups: readonly { id: string; kinds: readonly ("text" | "voice")[]; permissions: readonly PermissionName[] }[]): { id: string; permissions: PermissionName[] }[] {
  return groups.filter((g) => kind === "category" || (g.kinds as readonly string[]).includes(kind)).map((g) => ({ id: g.id, permissions: [...g.permissions] }));
}
