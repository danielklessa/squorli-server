import { describe, expect, it } from "vitest";
import { AFK_MOVE_MINUTES, ClientEvent, DirectoryClientEvent, DirectoryServerEvent, Friend, Member, ServerEvent, ServerSettings, UpdateSettingsRequest } from "./index";

const KEY = "a".repeat(64);
const UUID = "6f1c2a4e-1b2c-4d3e-8f90-000000000000";

describe("AFK detection", () => {
  it("takes the activity report on both sockets", () => {
    expect(ClientEvent.safeParse({ type: "activity", idle: true }).success).toBe(true);
    expect(DirectoryClientEvent.safeParse({ type: "activity", idle: false }).success).toBe(true);
    expect(ClientEvent.safeParse({ type: "activity" }).success).toBe(false);
  });

  it("stays readable for data from before it: members, friends and presence default to not afk, settings may lack the fields", () => {
    const member = Member.parse({ userId: UUID, displayName: "A", publicKey: KEY, roleIds: [], joinedAt: "2026-09-17T00:00:00.000Z", online: true, streamBlocked: false, handle: null, isOwner: false });
    expect(member.afk).toBe(false);
    expect(Friend.parse({ handle: "anna", publicKey: KEY, displayName: null, state: "accepted", since: "2026-09-17T00:00:00.000Z", online: true }).afk).toBe(false);
    const presence = DirectoryServerEvent.parse({ type: "friends.presence", publicKey: KEY, online: true });
    expect(presence.type === "friends.presence" && presence.afk).toBe(false);
    const old = ServerSettings.parse({ name: "S", openJoin: true, ownerId: null, iconUrl: null, requireAccount: false, requireAccountLocked: false, listed: false, description: null });
    expect(old.afkChannelId).toBeUndefined();
    expect(old.afkMoveMinutes).toBeUndefined();
  });

  it("marks a move for inactivity, and older moves parse without a reason", () => {
    const moved = ServerEvent.parse({ type: "voice.moved", channelId: UUID, by: "Server", reason: "afk" });
    expect(moved.type === "voice.moved" && moved.reason).toBe("afk");
    expect(ServerEvent.safeParse({ type: "voice.moved", channelId: null, by: "Mod" }).success).toBe(true);
  });

  it("accepts only the offered move times and lets the AFK channel be cleared", () => {
    for (const n of AFK_MOVE_MINUTES) expect(UpdateSettingsRequest.safeParse({ afkMoveMinutes: n }).success).toBe(true);
    expect(UpdateSettingsRequest.safeParse({ afkMoveMinutes: 7 }).success).toBe(false);
    expect(UpdateSettingsRequest.parse({ afkChannelId: null })).toEqual({ afkChannelId: null });
    expect(UpdateSettingsRequest.safeParse({ afkChannelId: "lobby" }).success).toBe(false);
  });
});
