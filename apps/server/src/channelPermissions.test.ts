import { Permission } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { channelPermissions, defaultRolePermissions, markedPrivate, type ChannelResolveInput, type Overwrite } from "./channelPermissions";

const P = Permission;
const GUEST = "guest", MOD = "mod", TEAM = "team", ME = "me";
const base = P.VIEW_CHANNELS | P.CONNECT_VOICE | P.SEND_MESSAGES;
const role = (roleId: string, allow = 0, deny = 0): Overwrite => ({ roleId, userId: null, allow, deny });
const user = (userId: string, allow = 0, deny = 0): Overwrite => ({ roleId: null, userId, allow, deny });
const input = (over: Partial<ChannelResolveInput> = {}): ChannelResolveInput => ({
  base, isOwner: false, userId: ME, roleIds: [GUEST, MOD], defaultRoleId: GUEST, categoryOverwrites: [], channelOverwrites: [], ...over,
});
const has = (mask: number, perm: number) => (mask & perm) === perm;

describe("channelPermissions", () => {
  it("returns the base unchanged without overwrites (existing servers behave as before)", () => {
    expect(channelPermissions(input())).toBe(base);
  });
  it("owner and administrator ignore every overwrite", () => {
    const deny = [role(GUEST, 0, P.VIEW_CHANNELS), user(ME, 0, P.VIEW_CHANNELS)];
    expect(channelPermissions(input({ isOwner: true, channelOverwrites: deny }))).toBe(P.ADMINISTRATOR);
    expect(channelPermissions(input({ base: P.ADMINISTRATOR, channelOverwrites: deny }))).toBe(P.ADMINISTRATOR);
  });
  it("a private channel: the default role's deny hides it, a role allow shows it again", () => {
    const hidden = channelPermissions(input({ channelOverwrites: [role(GUEST, 0, P.VIEW_CHANNELS)] }));
    expect(has(hidden, P.VIEW_CHANNELS)).toBe(false);
    expect(has(hidden, P.SEND_MESSAGES)).toBe(true);
    const shown = channelPermissions(input({ channelOverwrites: [role(GUEST, 0, P.VIEW_CHANNELS), role(MOD, P.VIEW_CHANNELS)] }));
    expect(has(shown, P.VIEW_CHANNELS)).toBe(true);
  });
  it("applies Discord's order: everyone, roles (deny then allow), member (deny then allow)", () => {
    // Everyone denies, my role allows -> allowed.
    expect(has(channelPermissions(input({ channelOverwrites: [role(GUEST, 0, P.SEND_MESSAGES), role(MOD, P.SEND_MESSAGES)] })), P.SEND_MESSAGES)).toBe(true);
    // One role allows, another denies -> the union of allows wins over the union of denies (deny applied first).
    expect(has(channelPermissions(input({ roleIds: [GUEST, MOD, TEAM], channelOverwrites: [role(TEAM, 0, P.SEND_MESSAGES), role(MOD, P.SEND_MESSAGES)] })), P.SEND_MESSAGES)).toBe(true);
    // My own entry beats every role: a member deny after a role allow.
    expect(has(channelPermissions(input({ channelOverwrites: [role(MOD, P.SEND_MESSAGES), user(ME, 0, P.SEND_MESSAGES)] })), P.SEND_MESSAGES)).toBe(false);
    // A member allow beats a role deny.
    expect(has(channelPermissions(input({ channelOverwrites: [role(MOD, 0, P.SEND_MESSAGES), user(ME, P.SEND_MESSAGES)] })), P.SEND_MESSAGES)).toBe(true);
  });
  it("category first, channel on top: a channel allow undoes a category deny, neutral inherits", () => {
    const catDeny = [role(GUEST, 0, P.VIEW_CHANNELS)];
    expect(has(channelPermissions(input({ categoryOverwrites: catDeny })), P.VIEW_CHANNELS)).toBe(false);
    expect(has(channelPermissions(input({ categoryOverwrites: catDeny, channelOverwrites: [role(GUEST, P.VIEW_CHANNELS)] })), P.VIEW_CHANNELS)).toBe(true);
    // The channel names another bit only: the category's decision stays.
    expect(has(channelPermissions(input({ categoryOverwrites: catDeny, channelOverwrites: [role(GUEST, P.SEND_MESSAGES)] })), P.VIEW_CHANNELS)).toBe(false);
  });
  it("ignores roles the member does not hold, other members' entries and dangling ids", () => {
    const m = channelPermissions(input({ channelOverwrites: [role(TEAM, 0, P.SEND_MESSAGES), user("somebody", 0, P.SEND_MESSAGES), role("gone", 0, P.SEND_MESSAGES)] }));
    expect(has(m, P.SEND_MESSAGES)).toBe(true);
  });
  it("only touches channel-overridable bits: a server-wide right cannot be handed out per channel", () => {
    const m = channelPermissions(input({ channelOverwrites: [user(ME, P.BAN_MEMBERS | P.MANAGE_MESSAGES)] }));
    expect(has(m, P.BAN_MEMBERS)).toBe(false);
    expect(has(m, P.MANAGE_MESSAGES)).toBe(true);
  });
  it("tells whether the default role sees a channel (the private lock)", () => {
    expect(has(defaultRolePermissions(GUEST, base, [], []), P.VIEW_CHANNELS)).toBe(true);
    expect(has(defaultRolePermissions(GUEST, base, [role(GUEST, 0, P.VIEW_CHANNELS)], []), P.VIEW_CHANNELS)).toBe(false);
    // A public channel inside a private category.
    expect(has(defaultRolePermissions(GUEST, base, [role(GUEST, 0, P.VIEW_CHANNELS)], [role(GUEST, P.VIEW_CHANNELS)]), P.VIEW_CHANNELS)).toBe(true);
  });
});

describe("markedPrivate", () => {
  // The lock in the channel list means "set to private here or on the category", nothing else (user's rule, 23 September 2026).
  const VIEW = P.VIEW_CHANNELS;
  it("marks a channel whose own overwrite denies the default role the sight", () => {
    expect(markedPrivate(GUEST, base, [], [role(GUEST, 0, VIEW)])).toBe(true);
  });
  it("marks a channel that inherits the deny from its category", () => {
    expect(markedPrivate(GUEST, base, [role(GUEST, 0, VIEW)], [])).toBe(true);
  });
  it("does not mark a channel that allows the sight again against its category", () => {
    expect(markedPrivate(GUEST, base, [role(GUEST, 0, VIEW)], [role(GUEST, VIEW, 0)])).toBe(false);
  });
  it("leaves a plain channel alone, also when the default role has no VIEW_CHANNELS server-wide", () => {
    expect(markedPrivate(GUEST, base, [], [])).toBe(false);
    expect(markedPrivate(GUEST, base & ~VIEW, [], [])).toBe(false);
    expect(markedPrivate(GUEST, 0, [], [])).toBe(false);
  });
  it("ignores a deny that hits another role or a member, not everybody", () => {
    expect(markedPrivate(GUEST, base, [], [role(MOD, 0, VIEW)])).toBe(false);
    expect(markedPrivate(GUEST, base, [], [user(ME, 0, VIEW)])).toBe(false);
  });
  it("is not the same as \"the default role cannot see it\": that one still follows the server-wide mask", () => {
    expect(defaultRolePermissions(GUEST, base & ~VIEW, [], []) & VIEW).toBe(0);
    expect(markedPrivate(GUEST, base & ~VIEW, [], [])).toBe(false);
  });
});
