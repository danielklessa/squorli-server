import type { Member, Role } from "@squorli/protocol";

/**
 * The server's rank rules (`apps/server/src/authz.ts`, `actorOf` in `state.ts`) for the member menu, so that it only offers what the
 * server would accept (user's rule, 19 September 2026: what you cannot assign is not shown). Pure, tested. The server stays the
 * authority; this only decides what is drawn.
 */

/** Highest role position of a member, the default role included; owners stand above every role. */
export function topPositionOf(m: Pick<Member, "roleIds" | "isOwner">, roles: readonly Role[]): number {
  if (m.isOwner) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, ...roles.filter((r) => r.isDefault || m.roleIds.includes(r.id)).map((r) => r.position));
}

/**
 * May `me` change the roles of `target` at all? An owner's roles only by the first owner (`ownerId`); otherwise by an owner or by
 * someone whose highest role stands above the target's. The permission MANAGE_ROLES is checked by the caller.
 */
export function canSetRolesOf(me: Pick<Member, "userId" | "roleIds" | "isOwner">, target: Pick<Member, "userId" | "roleIds" | "isOwner">, roles: readonly Role[], ownerId: string | null): boolean {
  if (target.isOwner) return me.userId === ownerId && target.userId !== me.userId;
  return me.isOwner || topPositionOf(me, roles) > topPositionOf(target, roles);
}

/** The roles `me` may give or take: never the default role, and only roles below the own highest one (owners: all). */
export function assignableRoles(me: Pick<Member, "roleIds" | "isOwner">, roles: readonly Role[]): Role[] {
  const top = topPositionOf(me, roles);
  return roles.filter((r) => !r.isDefault && (me.isOwner || r.position < top));
}
