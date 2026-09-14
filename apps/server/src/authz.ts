import { Permission, hasPermission } from "@squorli/protocol";

/**
 * Reine Rechte-Logik ohne Datenbank, damit sie testbar ist.
 * Hierarchie: Der Eigentuemer steht ueber allem. Sonst zaehlt die hoechste Rollenposition;
 * wirken darf man nur auf Rollen und Mitglieder unterhalb der eigenen hoechsten Position.
 */
export type Actor = { userId: string; isOwner: boolean; permissions: number; topPosition: number };
export type Target = { userId: string; isOwner: boolean; topPosition: number };

export const can = (a: Actor, perm: number) => hasPermission(a.permissions, perm);

/** Darf actor auf target wirken (kicken, bannen, Rollen setzen)? Niemand wirkt auf sich selbst oder den Eigentuemer. */
export function outranks(a: Actor, t: Target): boolean {
  if (a.userId === t.userId || t.isOwner) return false;
  return a.isOwner || a.topPosition > t.topPosition;
}

/** Darf actor eine Rolle mit dieser Position bearbeiten, loeschen oder zuweisen? */
export function canTouchRole(a: Actor, rolePosition: number): boolean {
  return a.isOwner || rolePosition < a.topPosition;
}

/** Rechte vergeben darf man nur, was man selbst hat (Administrator: alles). */
export function canGrant(a: Actor, permissions: number): boolean {
  if (a.isOwner || hasPermission(a.permissions, Permission.ADMINISTRATOR)) return true;
  return (permissions & ~a.permissions) === 0;
}

/** Effektive Rechte aus Rollen; Eigentuemer ist immer Administrator. */
export function effectivePermissions(isOwner: boolean, roleMasks: number[]): number {
  if (isOwner) return Permission.ADMINISTRATOR;
  return roleMasks.reduce((m, r) => m | r, 0);
}
