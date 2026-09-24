import type { LivekitAdmin } from "../livekit/admin";
import type { VoicePresence } from "./presence";

/** How long the removed member's own client gets to hang up on `voice.moved` before LiveKit drops it. */
export const REMOVE_GRACE_MS = 2000;

/**
 * Takes a member out of a LiveKit room after a short grace (docs/features/channel-blocks.md, 24 September 2026). Removing
 * them at once raced the `voice.moved` that says why: when LiveKit's disconnect came first, the client showed
 * "Getrennt durch den Server (PARTICIPANT_REMOVED)" as an error instead of the removal notice (user's report). A client
 * that follows the event has left by then and the removal finds nobody; one that stays is removed all the same. Not when
 * the member sits in that channel again meanwhile (a moderator moved them back).
 */
export function removeLater(lk: LivekitAdmin, presence: VoicePresence, channelId: string, userId: string, onError: (err: unknown) => void): void {
  const timer = setTimeout(() => {
    if (presence.channelOfUser(userId) === channelId) return;
    lk.removeParticipant(channelId, userId).catch(onError);
  }, REMOVE_GRACE_MS);
  timer.unref();
}
