import { Permission } from "@squorli/protocol";
import { can } from "../authz";
import type { Db } from "../db";
import { actorOf, loadSettings } from "../state";
import type { VoicePresence } from "../voice/presence";
import type { LivekitAdmin } from "./admin";

/**
 * The publish grants of a LiveKit token are fixed when a member joins the voice channel. When their permissions change
 * while they sit there (roles assigned, a role's permissions edited, a role deleted, owner status), the client shows or
 * hides the camera and screen buttons at once (it gets the new permissions with the structure broadcast), but LiveKit
 * still goes by the old grants: "failed to publish track, insufficient permissions" for someone who just became "Mitglied"
 * (user's report, 18 September 2026), or a camera that stays on after the permission was taken away. This brings LiveKit in
 * line. Members in the AFK channel stay silenced (their way back is routes/settings.ts).
 */
export async function syncStreamGrants(
  seated: { userId: string; channelId: string }[],
  afkChannelId: string | null,
  mayStream: (userId: string) => Promise<boolean>,
  lk: Pick<LivekitAdmin, "setCanStream" | "stopStreams">,
): Promise<void> {
  for (const s of seated) {
    if (s.channelId === afkChannelId) continue;
    const allowed = await mayStream(s.userId);
    await lk.setCanStream(s.channelId, s.userId, allowed);
    if (!allowed) await lk.stopStreams(s.channelId, s.userId, { camera: true, screen: true });
  }
}

/** Route helper: sync everyone in voice, or only `userIds`. Nothing to do (and no query) while nobody of them is in voice. */
export async function syncStreamGrantsOf(db: Db, presence: VoicePresence, lk: LivekitAdmin, userIds?: string[]): Promise<void> {
  const seated = presence.seated().filter((s) => !userIds || userIds.includes(s.userId));
  if (!seated.length) return;
  const { afkChannelId } = await loadSettings(db);
  await syncStreamGrants(seated, afkChannelId ?? null, async (userId) => { const a = await actorOf(db, userId); return !!a && can(a, Permission.STREAM_VIDEO); }, lk);
}
