import { z } from "zod";
import { Iso, Uuid } from "./primitives";

/**
 * Channel blocks (docs/features/channel-blocks.md, 24 September 2026, user's wish): a moderator removes somebody from a
 * voice channel and keeps them out of that one channel for a while or for good; a passed vote kick
 * (docs/features/votekick.md) is the same kind of block for 15 minutes. Whoever may move members in the channel
 * (`MOVE_MEMBERS` resolved there) may set and lift them. A moderator's move into the channel still wins over a block.
 */

/** The durations the member menu offers; null in a request = permanent (user's list: 5, 15, 30, 60 minutes, permanent). */
export const CHANNEL_BLOCK_MINUTES = [5, 15, 30, 60] as const;
export const ChannelBlockMinutes = z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]);
export type ChannelBlockMinutes = z.infer<typeof ChannelBlockMinutes>;

/** `moderator` = set by hand, `votekick` = a passed vote kick. */
export const ChannelBlockSource = z.enum(["moderator", "votekick"]);
export type ChannelBlockSource = z.infer<typeof ChannelBlockSource>;

export const ChannelBlock = z.object({
  channelId: Uuid,
  userId: Uuid,
  /** null = permanent. */
  until: Iso.nullable(),
  source: ChannelBlockSource,
  /** Display name of the moderator who set it; null for a vote kick or a moderator who is gone. */
  blockedBy: z.string().nullable(),
  createdAt: Iso,
});
export type ChannelBlock = z.infer<typeof ChannelBlock>;

/** GET /api/channel-blocks: the running blocks of every channel in which the asker may move members. */
export const ChannelBlocksResponse = z.array(ChannelBlock);

/** PUT /api/channels/:id/blocks: block a member (and remove them when they sit in the channel). */
export const SetChannelBlockRequest = z.object({ userId: Uuid, minutes: ChannelBlockMinutes.nullable() });
export type SetChannelBlockRequest = z.infer<typeof SetChannelBlockRequest>;
