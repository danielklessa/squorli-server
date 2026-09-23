import { Permission, hasPermission } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { Actor } from "../authz";
import type { Db } from "../db";
import { channels, members } from "../db/schema";
import type { Hub } from "../hub";
import { sendStructureTo } from "../state";
import { visibility } from "../visibility";
import { confinementVerdict, moveGrants } from "./confine";
import type { VoicePresence } from "./presence";

/**
 * The database side of sticky voice channels (voice/confine.ts holds the pure decision; docs/features/channel-permissions.md).
 * `members.confined_channel_id` says where a member is held. Set when they take a seat in a sticky channel (joined,
 * moved, or put there by the AFK mover), cleared by a moderator's move, when the channel stops being sticky or is deleted,
 * and, unless the channel says `stickyPersist`, when the member's voice presence ends.
 */

/** Is the member held somewhere else than the channel they ask a token for? */
export async function stickyVerdict(db: Db, userId: string, actor: Actor, wanted: string): Promise<"ok" | "confined"> {
  await visibility.refresh(db);
  const lock = visibility.voiceLockOf(userId);
  return confinementVerdict({
    bypass: actor.isOwner || hasPermission(actor.permissions, Permission.ADMINISTRATOR),
    confinedTo: lock?.channelId ?? null, wanted, granted: moveGrants.grantOf(userId) === wanted,
  });
}

/** Write the hold (or its end) and tell the member: their channel list and `myVoiceLock` change with it. */
export async function setHold(db: Db, hub: Hub, userId: string, channelId: string | null): Promise<void> {
  await db.update(members).set({ confinedChannelId: channelId }).where(eq(members.userId, userId));
  visibility.invalidate();
  await sendStructureTo(db, hub, userId);
}

/** The member took a seat: a sticky channel holds them from now on, any other seat ends an old hold (a moderator moved them). */
export async function holdOnJoin(db: Db, hub: Hub, userId: string, channel: { id: string; sticky: boolean }): Promise<void> {
  const ctx = await visibility.refresh(db);
  const m = ctx.members.get(userId);
  if (!m) return;
  const exempt = hasPermission(visibility.masksOf(userId).get(channel.id) ?? 0, Permission.BYPASS_STICKY);
  const wanted = channel.sticky && !exempt ? channel.id : null;
  if (m.confinedChannelId !== wanted) await setHold(db, hub, userId, wanted);
}

/** The member's voice presence ended: without `stickyPersist` the hold ends with it. Then their view is brought up to date. */
export async function releaseOnLeave(db: Db, hub: Hub, presence: VoicePresence, userId: string): Promise<void> {
  if (!presence.channelOfUser(userId)) {
    const ctx = await visibility.refresh(db);
    const held = ctx.members.get(userId)?.confinedChannelId;
    if (held) {
      const [ch] = await db.select({ sticky: channels.sticky, persist: channels.stickyPersist }).from(channels).where(eq(channels.id, held)).limit(1);
      if (!ch?.sticky || !ch.persist) return setHold(db, hub, userId, null);
    }
  }
  await refreshUserView(db, hub, userId);
}

/** The member's seat changed: what they see may have changed with it (the seat exception), so their lists go out if so. */
export async function refreshUserView(db: Db, hub: Hub, userId: string): Promise<void> {
  visibility.forgetUser(userId);
  await sendStructureTo(db, hub, userId, true);
}

/** A sticky channel was turned off or deleted: everybody it held is free. */
export async function releaseAll(db: Db, hub: Hub, channelId: string): Promise<void> {
  const held = await db.update(members).set({ confinedChannelId: null }).where(eq(members.confinedChannelId, channelId)).returning({ userId: members.userId });
  if (!held.length) return;
  visibility.invalidate();
  for (const h of held) await sendStructureTo(db, hub, h.userId);
}
