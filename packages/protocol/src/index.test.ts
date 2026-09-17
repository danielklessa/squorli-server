import { describe, expect, it } from "vitest";
import {
  ClientEvent, CreateMessageRequest, MarkReadRequest, MuteRequest, ReadStateResponse, DEFAULT_EVERYONE_PERMISSIONS, DEFAULT_MEMBER_PERMISSIONS, PERMISSION_GROUPS, Permission, RtcTokenRequest, ServerEvent,
  UpdateMeRequest, VerifyRequest, challengeMessage, displayNameOf, hasPermission, permissionNames,
} from "./index";

const U1 = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";

describe("protocol", () => {
  it("carries read states and the event for my other devices", () => {
    expect(ReadStateResponse.safeParse({ channels: [{ channelId: U1, lastReadSeq: null, latestSeq: null, unread: false, mentions: 0 }, { channelId: U1, lastReadSeq: 4, latestSeq: 9, unread: true, mentions: 2 }] }).success).toBe(true);
    expect(ReadStateResponse.safeParse({ channels: [{ channelId: U1, lastReadSeq: 4, latestSeq: 9, unread: true, mentions: -1 }] }).success).toBe(false);
    expect(MarkReadRequest.safeParse({ seq: 12 }).success).toBe(true);
    expect(MarkReadRequest.safeParse({ seq: -1 }).success).toBe(false);
    expect(MarkReadRequest.safeParse({ seq: 1.5 }).success).toBe(false);
    expect(ServerEvent.safeParse({ type: "read.update", channelId: U1, lastReadSeq: 12 }).success).toBe(true);
    // Mutes: a server from before mutes leaves the fields out, the client reads that as "not muted".
    const old = ReadStateResponse.parse({ channels: [{ channelId: U1, lastReadSeq: 4, latestSeq: 9, unread: true, mentions: 0 }] });
    expect(old.serverMuted).toBe(false);
    expect(old.channels[0]?.muted).toBe(false);
    expect(ServerEvent.safeParse({ type: "mute.update", serverMuted: true, channelIds: [U1] }).success).toBe(true);
    expect(MuteRequest.safeParse({ muted: "ja" }).success).toBe(false);
  });
  it("parses a hello", () => {
    expect(ClientEvent.safeParse({ type: "hello", protocolVersion: 1, sessionToken: "x" }).success).toBe(true);
  });
  it("rejects unknown event types", () => {
    expect(ClientEvent.safeParse({ type: "nope" }).success).toBe(false);
  });
  it("binds the challenge to a domain", () => {
    expect(challengeMessage("a.example", "00")).not.toBe(challengeMessage("b.example", "00"));
  });
  it("parses voice and typing events with uuid channels", () => {
    expect(ClientEvent.safeParse({ type: "voice.join", channelId: U1 }).success).toBe(true);
    expect(ClientEvent.safeParse({ type: "voice.join", channelId: "lobby" }).success).toBe(false);
    expect(ClientEvent.safeParse({ type: "typing", channelId: U1 }).success).toBe(true);
    const state = ServerEvent.safeParse({ type: "voice.state", channelId: U1, members: [{ userId: U1, displayName: "Dani" }] });
    expect(state.success).toBe(true);
  });
  it("accepts optional invite on verify", () => {
    const base = { challengeId: U1, publicKey: "a".repeat(64), signature: "b".repeat(128) };
    expect(VerifyRequest.safeParse(base).success).toBe(true);
    expect(VerifyRequest.safeParse({ ...base, invite: "abc123XYZ_-" }).success).toBe(true);
    expect(VerifyRequest.safeParse({ ...base, invite: "no spaces!" }).success).toBe(false);
  });
  it("restricts rtc-token requests to channel ids", () => {
    expect(RtcTokenRequest.safeParse({ channelId: U1 }).success).toBe(true);
    expect(RtcTokenRequest.safeParse({ room: "lobby" }).success).toBe(false);
  });
  it("trims and bounds display names", () => {
    expect(UpdateMeRequest.parse({ displayName: "  Dani  " }).displayName).toBe("Dani");
    expect(UpdateMeRequest.safeParse({ displayName: "x".repeat(33) }).success).toBe(false);
  });
  it("requires content or attachment on messages", () => {
    expect(CreateMessageRequest.safeParse({ content: "   " }).success).toBe(false);
    expect(CreateMessageRequest.safeParse({ content: "hi" }).success).toBe(true);
    expect(CreateMessageRequest.safeParse({ content: "", attachmentIds: [U1] }).success).toBe(true);
  });
  it("falls back to a key-derived name", () => {
    expect(displayNameOf({ displayName: null, publicKey: "abcdef0123" })).toBe("anon-abcdef");
  });
});

describe("permissions", () => {
  it("shows every permission in exactly one group", () => {
    // A new permission must be sorted into PERMISSION_GROUPS by meaning (role editor); forgetting it fails here.
    const grouped = PERMISSION_GROUPS.flatMap((g) => [...g.permissions]);
    expect([...grouped].sort()).toEqual(Object.keys(Permission).sort());
    expect(new Set(PERMISSION_GROUPS.map((g) => g.id)).size).toBe(PERMISSION_GROUPS.length);
  });
  it("administrator implies everything", () => {
    expect(hasPermission(Permission.ADMINISTRATOR, Permission.BAN_MEMBERS)).toBe(true);
  });
  it("checks masks", () => {
    // Guest: view and voice only; member: post and stream
    expect(hasPermission(DEFAULT_EVERYONE_PERMISSIONS, Permission.VIEW_CHANNELS)).toBe(true);
    expect(hasPermission(DEFAULT_EVERYONE_PERMISSIONS, Permission.CONNECT_VOICE)).toBe(true);
    expect(hasPermission(DEFAULT_EVERYONE_PERMISSIONS, Permission.SEND_MESSAGES)).toBe(false);
    expect(hasPermission(DEFAULT_EVERYONE_PERMISSIONS, Permission.KICK_MEMBERS)).toBe(false);
    expect(hasPermission(DEFAULT_MEMBER_PERMISSIONS, Permission.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(DEFAULT_MEMBER_PERMISSIONS, Permission.STREAM_VIDEO)).toBe(true);
    expect(hasPermission(DEFAULT_MEMBER_PERMISSIONS, Permission.KICK_MEMBERS)).toBe(false);
    // Guests hear the voice channel but do not watch camera/screen; members do.
    expect(hasPermission(DEFAULT_EVERYONE_PERMISSIONS, Permission.VIEW_VIDEO)).toBe(false);
    expect(hasPermission(DEFAULT_MEMBER_PERMISSIONS, Permission.VIEW_VIDEO)).toBe(true);
    // The bit values are part of the migrations (0003/0004, VIEW_VIDEO 16384 in 0013); never renumber them.
    expect(Permission.VIEW_VIDEO).toBe(16384);
    expect(DEFAULT_EVERYONE_PERMISSIONS).toBe(1152);
    expect(DEFAULT_MEMBER_PERMISSIONS).toBe(7616 | 16384);
    expect(permissionNames(Permission.KICK_MEMBERS | Permission.BAN_MEMBERS)).toEqual(["KICK_MEMBERS", "BAN_MEMBERS"]);
  });
});
