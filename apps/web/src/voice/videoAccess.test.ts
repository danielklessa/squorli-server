import { Permission, type ServerState } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { subscriptionPermissions, videoAccessOf } from "./videoAccess";

const GUEST = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const BASE = Permission.VIEW_CHANNELS | Permission.CONNECT_VOICE;

const member = (userId: string, roleIds: string[], isOwner = false) =>
  ({ userId, displayName: userId, publicKey: "k", roleIds, joinedAt: "2026-09-17T00:00:00.000Z", online: true, afk: false, game: null, streamBlocked: false, handle: null, avatarUrl: null, localHandle: null, isOwner });

function server(guestMask: number, ownerId: string | null = null): Pick<ServerState, "settings" | "roles" | "members"> {
  return {
    settings: { ownerId } as ServerState["settings"],
    roles: [
      { id: GUEST, name: "Gast", color: null, permissions: guestMask, position: 0, isDefault: true },
      { id: MEMBER, name: "Mitglied", color: null, permissions: BASE | Permission.VIEW_VIDEO, position: 1, isDefault: false },
      { id: ADMIN, name: "Admin", color: null, permissions: Permission.ADMINISTRATOR, position: 2, isDefault: false },
    ],
    members: [member("d-guest", []), member("c-member", [MEMBER]), member("b-admin", [ADMIN]), member("a-owner", [], true), member("e-founder", [])],
  };
}

describe("videoAccessOf", () => {
  it("is open when the default role carries VIEW_VIDEO", () => {
    const a = videoAccessOf(server(BASE | Permission.VIEW_VIDEO));
    expect(a.open).toBe(true);
    expect(a.audioOnly).toEqual([]);
  });

  it("restricts members without the permission; roles, administrators and owners keep it", () => {
    const a = videoAccessOf(server(BASE, "e-founder"));
    expect(a.open).toBe(false);
    expect(a.viewers).toEqual(["a-owner", "b-admin", "c-member", "e-founder"]);
    expect(a.audioOnly).toEqual(["d-guest"]);
  });

  it("stays closed while every current member happens to have the permission", () => {
    const s = server(BASE);
    s.members = s.members.filter((m) => m.roleIds.length > 0 || m.isOwner);
    expect(videoAccessOf(s)).toEqual({ open: false, viewers: ["a-owner", "b-admin", "c-member"], audioOnly: [] });
  });
});

describe("subscriptionPermissions", () => {
  it("allows everyone while access is open", () => {
    expect(subscriptionPermissions({ open: true, viewers: ["a"], audioOnly: [] }, ["TR_mic"])).toEqual({ allAllowed: true, list: [] });
  });

  it("gives restricted members and unknown participants the microphone only", () => {
    const r = subscriptionPermissions({ open: false, viewers: ["a"], audioOnly: ["b"] }, ["TR_mic"], ["bot", "a"]);
    expect(r.allAllowed).toBe(false);
    expect(r.list).toEqual([
      { participantIdentity: "a", allowAll: true },
      { participantIdentity: "b", allowAll: false, allowedTrackSids: ["TR_mic"] },
      { participantIdentity: "bot", allowAll: false, allowedTrackSids: ["TR_mic"] },
    ]);
  });

  it("allows nothing, not everything, before the microphone is published", () => {
    const r = subscriptionPermissions({ open: false, viewers: [], audioOnly: ["b"] }, []);
    expect(r.list).toEqual([{ participantIdentity: "b", allowAll: false, allowedTrackSids: [] }]);
  });
});
