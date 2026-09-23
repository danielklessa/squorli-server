import { Permission, hasPermission } from "@squorli/protocol";
import type { Db } from "../db";
import type { Hub } from "../hub";
import { loadSettings } from "../state";
import { visibility } from "../visibility";
import type { VoicePresence } from "../voice/presence";
import type { LivekitAdmin } from "./admin";

/**
 * A LiveKit token's grants are fixed when a member joins the voice channel. When their permissions change while they sit
 * there (roles assigned, a role's permissions edited, a role deleted, owner status, and since channel permissions an
 * overwrite of the channel or its category, or the channel moved to another category), the client shows or hides the
 * camera and screen buttons at once (it gets the new permissions with the structure broadcast), but LiveKit still goes by
 * the old grants: "failed to publish track, insufficient permissions" for someone who just became "Mitglied" (user's
 * report, 18 September 2026), or a camera that stays on after the permission was taken away. This brings LiveKit in line.
 *
 * Since channel permissions (docs/features/channel-permissions.md) it also throws out: a member who may no longer see or
 * enter the channel they sit in is removed from the room, because LiveKit checks a token only at the join and would let
 * them keep hearing the channel for ever otherwise. Not thrown out: a member a moderator placed there (VoicePresence
 * `placed`), they never needed the permission. Members in the AFK channel stay silenced (their way back is routes/settings.ts).
 */
export type VoiceAccess = { mayStay: boolean; mayStream: boolean };

export async function syncVoiceAccess(
  seated: { userId: string; channelId: string }[],
  afkChannelId: string | null,
  accessOf: (userId: string, channelId: string) => Promise<VoiceAccess>,
  lk: Pick<LivekitAdmin, "setCanStream" | "stopStreams" | "removeParticipant">,
  evict: (userId: string, channelId: string) => void,
): Promise<void> {
  for (const s of seated) {
    const access = await accessOf(s.userId, s.channelId);
    if (!access.mayStay) {
      await lk.removeParticipant(s.channelId, s.userId);
      evict(s.userId, s.channelId);
      continue;
    }
    if (s.channelId === afkChannelId) continue;
    await lk.setCanStream(s.channelId, s.userId, access.mayStream);
    if (!access.mayStream) await lk.stopStreams(s.channelId, s.userId, { camera: true, screen: true });
  }
}

/**
 * Route helper: sync everyone in voice, or only some users or channels. Nothing to do (and no query) while nobody of them
 * is in voice. Call it before the structure broadcast in every route that can change what a seated member may do.
 */
export async function syncVoiceAccessOf(db: Db, hub: Hub, presence: VoicePresence, lk: LivekitAdmin, only?: { userIds?: string[]; channelIds?: string[] }): Promise<void> {
  const seated = presence.seated().filter((s) => (!only?.userIds || only.userIds.includes(s.userId)) && (!only?.channelIds || only.channelIds.includes(s.channelId)));
  if (!seated.length) return;
  const settings = await loadSettings(db);
  visibility.invalidate();
  const ctx = await visibility.refresh(db);
  const allowVideo = new Map(ctx.channels.map((c) => [c.id, c.allowVideo]));
  await syncVoiceAccess(seated, settings.afkChannelId ?? null, async (userId, channelId) => {
    visibility.forgetUser(userId);
    const raw = visibility.resolvedMask(userId, channelId);
    const placed = presence.isPlaced(userId, channelId);
    return {
      mayStay: placed || (hasPermission(raw, Permission.VIEW_CHANNELS) && hasPermission(raw, Permission.CONNECT_VOICE)),
      mayStream: hasPermission(raw, Permission.STREAM_VIDEO) && (allowVideo.get(channelId) ?? true),
    };
  }, lk, (userId) => {
    hub.sendToUser(userId, { type: "voice.moved", channelId: null, by: settings.name });
    presence.leaveUser(userId);
  });
}
