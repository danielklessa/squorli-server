import { Permission } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { canGrant, canTouchRole, effectivePermissions, outranks, type Actor } from "./authz";

const owner: Actor = { userId: "o", isOwner: true, permissions: Permission.ADMINISTRATOR, topPosition: 0 };
const mod: Actor = { userId: "m", isOwner: false, permissions: Permission.KICK_MEMBERS | Permission.MANAGE_ROLES, topPosition: 5 };

describe("authz", () => {
  it("owner outranks everyone but themselves", () => {
    expect(outranks(owner, { userId: "x", isOwner: false, topPosition: 99 })).toBe(true);
    expect(outranks(owner, { userId: "o", isOwner: true, topPosition: 0 })).toBe(false);
  });
  it("nobody outranks the owner or themselves", () => {
    expect(outranks(mod, { userId: "o", isOwner: true, topPosition: 0 })).toBe(false);
    expect(outranks(mod, { userId: "m", isOwner: false, topPosition: 5 })).toBe(false);
  });
  it("position decides between members", () => {
    expect(outranks(mod, { userId: "a", isOwner: false, topPosition: 4 })).toBe(true);
    expect(outranks(mod, { userId: "b", isOwner: false, topPosition: 5 })).toBe(false);
  });
  it("roles below own top position are touchable", () => {
    expect(canTouchRole(mod, 4)).toBe(true);
    expect(canTouchRole(mod, 5)).toBe(false);
    expect(canTouchRole(owner, 1000)).toBe(true);
  });
  it("cannot grant more than one has", () => {
    expect(canGrant(mod, Permission.KICK_MEMBERS)).toBe(true);
    expect(canGrant(mod, Permission.BAN_MEMBERS)).toBe(false);
    expect(canGrant({ ...mod, permissions: Permission.ADMINISTRATOR }, Permission.BAN_MEMBERS)).toBe(true);
  });
  it("owner is administrator regardless of roles", () => {
    expect(effectivePermissions(true, [])).toBe(Permission.ADMINISTRATOR);
    expect(effectivePermissions(false, [1, 4])).toBe(5);
  });
});
