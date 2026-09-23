import { CHANNEL_PERMISSION_GROUPS, Permission, type PermissionOverwrite, type Role } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { baseOf, effectiveNotify, everyoneDenies, inheritedFrom, overwriteState, permissionsFor, resolveIn, setOverwriteState, slowmodeLabel, slowmodeRemaining, withEveryoneDeny } from "./channelPerms";

const P = Permission;
const GUEST = "guest", MOD = "mod", ME = "me";
const role = (targetId: string, allow = 0, deny = 0): PermissionOverwrite => ({ targetType: "role", targetId, allow, deny });
const user = (targetId: string, allow = 0, deny = 0): PermissionOverwrite => ({ targetType: "member", targetId, allow, deny });
const has = (m: number, p: number) => (m & p) === p;
const base = P.VIEW_CHANNELS | P.SEND_MESSAGES | P.CONNECT_VOICE;
const me = { userId: ME, isOwner: false, base, roleIds: [GUEST, MOD] };

describe("overwrite states", () => {
  it("reads and writes one permission without touching the others", () => {
    const o = role(MOD, P.SEND_MESSAGES, P.VIEW_CHANNELS);
    expect(overwriteState(o, P.SEND_MESSAGES)).toBe("allow");
    expect(overwriteState(o, P.VIEW_CHANNELS)).toBe("deny");
    expect(overwriteState(o, P.ATTACH_FILES)).toBe("neutral");
    const denied = setOverwriteState(o, P.SEND_MESSAGES, "deny");
    expect(overwriteState(denied, P.SEND_MESSAGES)).toBe("deny");
    expect(denied.allow & P.SEND_MESSAGES).toBe(0);
    expect(overwriteState(setOverwriteState(denied, P.SEND_MESSAGES, "neutral"), P.SEND_MESSAGES)).toBe("neutral");
    expect(overwriteState(denied, P.VIEW_CHANNELS)).toBe("deny");
  });
});

describe("resolveIn (mirrors the server)", () => {
  it("is the base without entries, and everything for an owner or administrator", () => {
    expect(resolveIn(me, GUEST, [], [])).toBe(base);
    expect(resolveIn({ ...me, isOwner: true }, GUEST, [], [role(GUEST, 0, P.VIEW_CHANNELS)])).toBe(P.ADMINISTRATOR);
  });
  it("applies everyone, roles, the member; category before channel", () => {
    expect(has(resolveIn(me, GUEST, [], [role(GUEST, 0, P.VIEW_CHANNELS)]), P.VIEW_CHANNELS)).toBe(false);
    expect(has(resolveIn(me, GUEST, [], [role(GUEST, 0, P.VIEW_CHANNELS), role(MOD, P.VIEW_CHANNELS)]), P.VIEW_CHANNELS)).toBe(true);
    expect(has(resolveIn(me, GUEST, [], [role(MOD, P.SEND_MESSAGES), user(ME, 0, P.SEND_MESSAGES)]), P.SEND_MESSAGES)).toBe(false);
    expect(has(resolveIn(me, GUEST, [role(GUEST, 0, P.VIEW_CHANNELS)], [role(GUEST, P.VIEW_CHANNELS)]), P.VIEW_CHANNELS)).toBe(true);
    expect(has(resolveIn(me, GUEST, [role(GUEST, 0, P.VIEW_CHANNELS)], []), P.VIEW_CHANNELS)).toBe(false);
  });
  it("computes the base out of the roles like the server", () => {
    const roles: Role[] = [
      { id: GUEST, name: "Gast", color: null, permissions: P.VIEW_CHANNELS, position: 0, isDefault: true },
      { id: MOD, name: "Mod", color: null, permissions: P.SEND_MESSAGES, position: 1, isDefault: false },
      { id: "x", name: "X", color: null, permissions: P.BAN_MEMBERS, position: 2, isDefault: false },
    ];
    expect(baseOf([MOD], roles)).toBe(P.VIEW_CHANNELS | P.SEND_MESSAGES);
    expect(baseOf([], roles)).toBe(P.VIEW_CHANNELS);
  });
});

describe("the inherits hint", () => {
  it("names the category's entry for the same target, else the server", () => {
    const cat = [role(MOD, 0, P.SEND_MESSAGES)];
    expect(inheritedFrom({ targetType: "role", targetId: MOD }, P.SEND_MESSAGES, cat, base)).toEqual({ state: "deny", source: "category" });
    expect(inheritedFrom({ targetType: "role", targetId: MOD }, P.VIEW_CHANNELS, cat, base)).toEqual({ state: "allow", source: "server" });
    expect(inheritedFrom({ targetType: "role", targetId: GUEST }, P.SEND_MESSAGES, cat, 0)).toEqual({ state: "deny", source: "server" });
  });
});

describe("the private switch", () => {
  it("is an everyone deny of VIEW_CHANNELS and keeps the editor in", () => {
    const on = withEveryoneDeny([], GUEST, P.VIEW_CHANNELS, true, ME);
    expect(everyoneDenies(on, GUEST, P.VIEW_CHANNELS)).toBe(true);
    expect(on).toContainEqual(user(ME, P.VIEW_CHANNELS));
    const off = withEveryoneDeny(on, GUEST, P.VIEW_CHANNELS, false);
    expect(everyoneDenies(off, GUEST, P.VIEW_CHANNELS)).toBe(false);
    // The empty everyone entry is gone, the editor's allow stays (it says something).
    expect(off.some((o) => o.targetId === GUEST)).toBe(false);
    expect(off.some((o) => o.targetId === ME)).toBe(true);
  });
  it("leaves other bits of the everyone entry alone", () => {
    const list = withEveryoneDeny([role(GUEST, P.CONNECT_VOICE, P.SEND_MESSAGES)], GUEST, P.VIEW_CHANNELS, true);
    const e = list.find((o) => o.targetId === GUEST)!;
    expect(e.allow).toBe(P.CONNECT_VOICE);
    expect(e.deny).toBe(P.SEND_MESSAGES | P.VIEW_CHANNELS);
  });
});

describe("slowmode", () => {
  it("counts down in whole seconds and is over at zero", () => {
    expect(slowmodeRemaining(10_000, null, 5)).toBe(0);
    expect(slowmodeRemaining(10_000, 8_000, 5)).toBe(3);
    expect(slowmodeRemaining(10_000, 8_000, 0)).toBe(0);
    expect(slowmodeRemaining(13_000, 8_000, 5)).toBe(0);
    expect(slowmodeRemaining(12_100, 8_000, 5)).toBe(1);
  });
  it("labels with the fitting unit", () => {
    const u = { s: "s", min: "min", h: "h" };
    expect(slowmodeLabel(5, u)).toBe("5 s");
    expect(slowmodeLabel(120, u)).toBe("2 min");
    expect(slowmodeLabel(3600, u)).toBe("1 h");
  });
});

describe("notifications and groups", () => {
  it("lets the member's own mute win over the channel's suggestion", () => {
    expect(effectiveNotify("none", null)).toBe("none");
    expect(effectiveNotify("none", false)).toBe("all");
    expect(effectiveNotify("all", true)).toBe("mentions");
  });
  it("lists a text channel's groups without the voice ones, a category with all", () => {
    const text = permissionsFor("text", CHANNEL_PERMISSION_GROUPS).map((g) => g.id);
    expect(text).toEqual(["general", "text"]);
    expect(permissionsFor("category", CHANNEL_PERMISSION_GROUPS).map((g) => g.id)).toEqual(["general", "text", "voice"]);
  });
});
