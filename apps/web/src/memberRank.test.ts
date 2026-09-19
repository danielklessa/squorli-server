import type { Role } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { assignableRoles, canSetRolesOf, topPositionOf } from "./memberRank";

const role = (id: string, position: number, isDefault = false): Role => ({ id, name: id, color: null, permissions: 0, position, isDefault });
const roles = [role("guest", 0, true), role("member", 1), role("mod", 5), role("admin", 9)];
const m = (userId: string, roleIds: string[], isOwner = false) => ({ userId, roleIds, isOwner });
const founder = m("founder", [], true); const owner2 = m("owner2", ["member"], true);
const admin = m("admin", ["admin"]); const mod = m("mod", ["mod", "member"]); const guest = m("guest", []);

describe("member rank", () => {
  it("takes the highest role, the default role included, and puts owners above everything", () => {
    expect(topPositionOf(guest, roles)).toBe(0);
    expect(topPositionOf(mod, roles)).toBe(5);
    expect(topPositionOf(owner2, roles)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("lets only the first owner change another owner's roles", () => {
    expect(canSetRolesOf(founder, owner2, roles, "founder")).toBe(true);
    expect(canSetRolesOf(owner2, founder, roles, "founder")).toBe(false);
    expect(canSetRolesOf(owner2, m("owner3", [], true), roles, "founder")).toBe(false);
    expect(canSetRolesOf(admin, owner2, roles, "founder")).toBe(false);
  });
  it("otherwise needs an owner or a higher role than the target's", () => {
    expect(canSetRolesOf(owner2, admin, roles, "founder")).toBe(true);
    expect(canSetRolesOf(admin, mod, roles, "founder")).toBe(true);
    expect(canSetRolesOf(mod, admin, roles, "founder")).toBe(false);
    expect(canSetRolesOf(mod, m("mod2", ["mod"]), roles, "founder")).toBe(false);
    expect(canSetRolesOf(mod, guest, roles, "founder")).toBe(true);
  });
  it("offers only roles below the own highest one, never the default role", () => {
    expect(assignableRoles(mod, roles).map((r) => r.id)).toEqual(["member"]);
    expect(assignableRoles(admin, roles).map((r) => r.id)).toEqual(["member", "mod"]);
    expect(assignableRoles(founder, roles).map((r) => r.id)).toEqual(["member", "mod", "admin"]);
    expect(assignableRoles(guest, roles)).toEqual([]);
  });
});
