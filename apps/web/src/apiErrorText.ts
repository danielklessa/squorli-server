import { ApiError } from "./api";
import { t } from "./i18n";

/**
 * A server refusal as a sentence for the user. An ApiError's message is its request line ("POST /api/rtc-token -> 403
 * (forbidden)"), fine for a log and useless in a dialog (user's report, 23 September 2026). The codes are the ones the
 * routes send (apps/server/src/livekit/routes.ts, routes/members.ts); anything else keeps the bare message.
 */
type Key = Parameters<typeof t>[0];
const shared: Record<string, Key> = {
  confined: "voice.stickyBlocked",
  channel_full: "voice.joinErr.full",
  unknown_channel: "voice.joinErr.gone",
};

/** POST /api/rtc-token before the voice client had a say. */
export function joinErrorText(err: unknown): string {
  return explain(err, { ...shared, forbidden: "voice.joinErr.forbidden", votekicked: "voice.joinErr.votekicked" }, "voice.joinErr.generic");
}

/** POST /api/members/:id/move (a drag in the sidebar, the member list's menu). */
export function moveErrorText(err: unknown): string {
  return explain(err, { ...shared, confined: "members.moveErr.confined", forbidden: "members.moveErr.forbidden", not_found: "members.moveErr.gone", target_above_you: "members.moveErr.aboveYou", not_in_voice: "members.moveErr.notInVoice" }, "members.moveErr.generic");
}

/** POST /api/channels/:id/votekick (the menu entry) and .../vote (the modal). */
export function voteKickErrorText(err: unknown): string {
  return explain(err, {
    votekick_disabled: "votekick.err.disabled", moderator_present: "votekick.err.moderator", too_few_members: "votekick.err.tooFew",
    not_in_channel: "votekick.err.notInChannel", target_not_in_channel: "votekick.err.targetGone", vote_running: "votekick.err.running",
    cooldown: "votekick.err.cooldown", no_vote: "votekick.err.noVote", not_eligible: "votekick.err.notEligible", already_voted: "votekick.err.alreadyVoted",
    unknown_channel: "voice.joinErr.gone",
  }, "votekick.err.generic");
}

function explain(err: unknown, keys: Record<string, Key>, generic: Key): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : String(err);
  const key = err.code ? keys[err.code] : undefined;
  if (key) return t(key);
  if (err.status === 401) return t("voice.joinErr.session");
  return t(generic, { message: err.message });
}
