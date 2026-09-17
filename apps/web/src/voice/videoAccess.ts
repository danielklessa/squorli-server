import { Permission, hasPermission, type ServerState } from "@squorli/protocol";
import type { ParticipantTrackPermission } from "livekit-client";

/**
 * Who may receive camera and screen tracks (permission VIEW_VIDEO). LiveKit has no per-source subscribe grant
 * in the token, so every sender restricts its own tracks (`setTrackSubscriptionPermissions`) and LiveKit enforces that:
 * members without the permission are only allowed the microphone track. The list comes from the server state
 * (roles and members as sent by the app server), never from anything a participant says about themselves.
 */
export type VideoAccess = {
  /** The default role carries VIEW_VIDEO, so every member has it and nothing needs restricting. */
  open: boolean;
  /** Members (user id = LiveKit identity) who may receive everything. */
  viewers: string[];
  /** Members who only get the microphone. */
  audioOnly: string[];
};

/** Effective permissions as the app server computes them: OR of the member's roles and the default role, owners are administrators. */
export function videoAccessOf(server: Pick<ServerState, "settings" | "roles" | "members">): VideoAccess {
  const everyone = server.roles.find((r) => r.isDefault)?.permissions ?? 0;
  const masks = new Map(server.roles.map((r) => [r.id, r.permissions]));
  const viewers: string[] = [];
  const audioOnly: string[] = [];
  for (const m of server.members) {
    const owner = m.isOwner || m.userId === server.settings.ownerId;
    const mask = owner ? Permission.ADMINISTRATOR : m.roleIds.reduce((a, id) => a | (masks.get(id) ?? 0), everyone);
    (hasPermission(mask, Permission.VIEW_VIDEO) ? viewers : audioOnly).push(m.userId);
  }
  // Decided by the default role, not by an empty audioOnly list: a member who joins the server a moment from now
  // only has the default role, and must not slip through before the member list arrives here.
  return { open: hasPermission(everyone, Permission.VIEW_VIDEO), viewers: viewers.sort(), audioOnly: audioOnly.sort() };
}

/**
 * Arguments for `setTrackSubscriptionPermissions`. `external` = participants in the room who are no members (bots):
 * microphone only, like everyone we cannot vouch for. An empty `allowedTrackSids` means nothing at all; leaving it
 * out would mean everything, so it is always set.
 */
export function subscriptionPermissions(access: VideoAccess, micSids: string[], external: string[] = []): { allAllowed: boolean; list: ParticipantTrackPermission[] } {
  if (access.open) return { allAllowed: true, list: [] };
  const known = new Set([...access.viewers, ...access.audioOnly]);
  const micOnly = [...access.audioOnly, ...external.filter((id) => !known.has(id)).sort()];
  return {
    allAllowed: false,
    list: [
      ...access.viewers.map((id) => ({ participantIdentity: id, allowAll: true })),
      ...micOnly.map((id) => ({ participantIdentity: id, allowAll: false, allowedTrackSids: [...micSids] })),
    ],
  };
}
