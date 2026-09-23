import { z } from "zod";
import { Uuid } from "./primitives";

/**
 * Channel permissions (docs/features/channel-permissions.md, 23 September 2026): a channel or category carries any number
 * of overwrites, one per role or member, each an allow mask and a deny mask over CHANNEL_OVERRIDABLE (permissions.ts). A bit
 * in neither = neutral, the value is inherited (channel from category, category from the roles' server-wide masks).
 * Resolution order, the same as Discord's so imported overwrites mean the same: the default role's deny then allow, the
 * union of the member's other roles' denies then allows, the member's own deny then allow; category first, then channel.
 */
export const OverwriteTarget = z.enum(["role", "member"]);
export const PermissionOverwrite = z.object({
  targetType: OverwriteTarget,
  targetId: Uuid,
  allow: z.number().int().nonnegative(),
  deny: z.number().int().nonnegative(),
});
export const MAX_OVERWRITES = 200;
/** PUT /api/channels/:id/overwrites and /api/categories/:id/overwrites: the complete list (like PUT .../roles). */
export const SetOverwritesRequest = z.object({ overwrites: z.array(PermissionOverwrite).max(MAX_OVERWRITES) });
export const OverwritesResponse = z.object({ overwrites: z.array(PermissionOverwrite) });

/** The channel's suggestion for members who set nothing themselves (their own mute wins, docs/features/mentions-unread.md). */
export const ChannelNotification = z.enum(["all", "mentions", "none"]);
/** Slowmode: seconds a member must wait between two messages in a text channel (0 = off); 6 hours at most. */
export const SLOWMODE_MAX = 21600;
export const SlowmodeSeconds = z.number().int().min(0).max(SLOWMODE_MAX);
/** Voice channels: how many may sit inside (null = no limit); best effort, a moderator's move ignores it. */
export const UserLimit = z.number().int().min(1).max(99).nullable();

/** Where a sticky voice channel holds a member (ServerState.myVoiceLock; POST /api/rtc-token answers 403 `confined` with it). */
export const VoiceLock = z.object({
  channelId: Uuid,
  /** While held there, other voice channels are left out of the member's channel list (the channel's `stickyHideVoice`). */
  hideVoice: z.boolean(),
});

export type OverwriteTarget = z.infer<typeof OverwriteTarget>;
export type PermissionOverwrite = z.infer<typeof PermissionOverwrite>;
export type SetOverwritesRequest = z.infer<typeof SetOverwritesRequest>;
export type OverwritesResponse = z.infer<typeof OverwritesResponse>;
export type ChannelNotification = z.infer<typeof ChannelNotification>;
export type VoiceLock = z.infer<typeof VoiceLock>;
