import { Permission, hasPermission } from "@squorli/protocol";

/**
 * Pure permission logic without a database, so it stays testable.
 * Hierarchy: the owner outranks everything. Otherwise the highest role position counts;
 * you may only act on roles and members below your own highest position.
 */
export type Actor = { userId: string; isOwner: boolean; permissions: number; topPosition: number };
export type Target = { userId: string; isOwner: boolean; topPosition: number };

export const can = (a: Actor, perm: number) => hasPermission(a.permissions, perm);

/** May actor act on target (kick, ban, set roles)? Nobody acts on themselves or on the owner. */
export function outranks(a: Actor, t: Target): boolean {
  if (a.userId === t.userId || t.isOwner) return false;
  return a.isOwner || a.topPosition > t.topPosition;
}

/** May actor edit, delete or assign a role at this position? */
export function canTouchRole(a: Actor, rolePosition: number): boolean {
  return a.isOwner || rolePosition < a.topPosition;
}

/** You may only grant permissions you hold yourself (administrator: everything). */
export function canGrant(a: Actor, permissions: number): boolean {
  if (a.isOwner || hasPermission(a.permissions, Permission.ADMINISTRATOR)) return true;
  return (permissions & ~a.permissions) === 0;
}

/** Effective permissions from roles; an owner is always an administrator. */
export function effectivePermissions(isOwner: boolean, roleMasks: number[]): number {
  if (isOwner) return Permission.ADMINISTRATOR;
  return roleMasks.reduce((m, r) => m | r, 0);
}
