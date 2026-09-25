import { Permission, hasPermission, type ServerEvent, type VoiceMember } from "@squorli/protocol";
import { visibility } from "../visibility";
import { isVoiceModerator, voteKickOffered, voteKicks } from "./votekick";

/**
 * The `voice.state` event of one channel. Besides the members it carries whether a vote kick could be started here right
 * now (docs/features/votekick.md): that depends on the channel, on who sits in it and on whether a vote is running, so it
 * is computed here, where both the presence broadcast (ws/handler.ts) and the vote routes can reach it.
 *
 * Synchronous over the current visibility snapshot; before the first refresh nothing is offered (a client that asks
 * anyway is refused by the route, which awaits the snapshot).
 */
export function voiceStateEvent(channelId: string, members: VoiceMember[]): ServerEvent {
  const channel = visibility.current?.channels.find((c) => c.id === channelId);
  const voteKick = !!channel && voteKickOffered({
    allowVoteKick: channel.allowVoteKick,
    memberIds: members.map((m) => m.userId),
    running: voteKicks.running(channelId) !== undefined,
    moderator: (userId) => isVoiceModerator(visibility.masksOf(userId).get(channelId) ?? 0, visibility.actorOf(userId)?.permissions ?? 0),
  });
  // VIEW_VIDEO in this channel, through its overwrites: the senders restrict their camera and screen to these members.
  const withView = members.map((m) => ({ ...m, viewVideo: hasPermission(visibility.resolvedMask(m.userId, channelId), Permission.VIEW_VIDEO) }));
  return { type: "voice.state", channelId, members: withView, voteKick };
}
