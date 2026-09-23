import type { Member, Role } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { entryKey, rankMatch, suggestEntities } from "./pickerEntries";

const role = (id: string, name: string, isDefault = false): Role => ({ id, name, color: null, permissions: 0, position: 1, isDefault });
const member = (userId: string, displayName: string, handle: string | null = null): Member => ({
  userId, displayName, publicKey: "k".repeat(64), roleIds: [], joinedAt: "2026-09-23T00:00:00.000Z", online: true, afk: false, game: null, streamBlocked: false, handle, avatarUrl: null, isOwner: false,
});
const roles = [role("g", "Gast", true), role("m", "Moderator"), role("t", "Team")];
const members = [member("u1", "Anna Meier", "anna"), member("u2", "Tom"), member("u3", "Moritz", "mo")];

describe("suggestEntities", () => {
  it("ranks starts-with before word-start before contains, roles before members at equal rank, never the default role", () => {
    const got = suggestEntities(roles, members, "mo").map(entryKey);
    expect(got).toEqual(["role:m", "member:u3"]);
    expect(suggestEntities(roles, members, "").map(entryKey)).toEqual(["role:m", "role:t", "member:u1", "member:u3", "member:u2"]);
    expect(suggestEntities(roles, members, "meier").map(entryKey)).toEqual(["member:u1"]);
  });
  it("leaves out what is already in the list and stops at the limit", () => {
    expect(suggestEntities(roles, members, "", { exclude: new Set(["role:m", "member:u2"]) }).map(entryKey)).toEqual(["role:t", "member:u1", "member:u3"]);
    expect(suggestEntities(roles, members, "", { limit: 2 }).length).toBe(2);
  });
  it("matches handles too", () => {
    expect(rankMatch("Anna Meier", "anna", "an")).toBe(0);
    expect(rankMatch("Anna Meier", null, "mei")).toBe(1);
    expect(rankMatch("Anna Meier", null, "nn")).toBe(2);
    expect(rankMatch("Anna Meier", null, "x")).toBe(-1);
  });
});
