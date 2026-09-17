import { describe, expect, it } from "vitest";
import type { Role } from "@squorli/protocol";
import { roleOrder } from "./roleOrder";

const role = (id: string, position: number, isDefault = false): Role => ({ id, name: id, position, isDefault, color: null, permissions: 0 });
describe("role ordering", () => {
  const roles = [role("admin", 10), role("a", 3), role("b", 1), role("default", 0, true)];
  it("moves upwards and downwards while preserving rank slots", () => {
    expect(roleOrder(roles, "b", "a", false, 10)).toEqual([{ id: "b", position: 3 }, { id: "a", position: 1 }]);
    expect(roleOrder(roles, "a", "b", true, 10)).toEqual([{ id: "b", position: 3 }, { id: "a", position: 1 }]);
  });
  it("keeps default and own or higher roles fixed", () => {
    for (const [id, target] of [["admin", "a"], ["a", "admin"], ["default", "a"], ["a", "default"], ["gone", "a"]]) {
      expect(roleOrder(roles, id!, target!, false, 10)).toEqual([]);
    }
  });
  it("repairs tied positions without crossing the actor's rank", () => {
    const tied = [role("a", 1), role("b", 1), role("default", 0, true)];
    expect(roleOrder(tied, "b", "a", false, 3)).toEqual([{ id: "b", position: 2 }]);
    expect(roleOrder(tied, "b", "a", false, 2)).toBeNull();
    expect(tied.map((r) => r.position)).toEqual([1, 1, 0]);
  });
  it("allows owners to move the highest role and ignores no-op drops", () => {
    expect(roleOrder(roles, "a", "admin", false, Infinity)).toEqual([{ id: "a", position: 10 }, { id: "admin", position: 3 }]);
    expect(roleOrder(roles, "a", "b", false, 10)).toEqual([]);
    expect(roleOrder(roles, "a", "a", false, 10)).toEqual([]);
  });
});
