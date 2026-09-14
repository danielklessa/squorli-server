/**
 * Rechte als Bitmaske. Rollen tragen eine Maske, ein Mitglied hat die ODER-Summe seiner Rollen.
 * ADMINISTRATOR schliesst alles ein. Neue Rechte immer hinten anhaengen, nie umnummerieren.
 */
export const Permission = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  KICK_MEMBERS: 1 << 4,
  BAN_MEMBERS: 1 << 5,
  CREATE_INVITES: 1 << 6,
  VIEW_CHANNELS: 1 << 7,
  SEND_MESSAGES: 1 << 8,
  MANAGE_MESSAGES: 1 << 9,
  CONNECT_VOICE: 1 << 10,
  ATTACH_FILES: 1 << 11,
  STREAM_VIDEO: 1 << 12,
  MODERATE_VOICE: 1 << 13,
} as const;

export type PermissionName = keyof typeof Permission;

export const PERMISSION_LABELS: Record<PermissionName, string> = {
  ADMINISTRATOR: "Administrator (alle Rechte)",
  MANAGE_SERVER: "Server verwalten (Name, Beitritt)",
  MANAGE_CHANNELS: "Kanäle und Kategorien verwalten",
  MANAGE_ROLES: "Rollen verwalten und zuweisen",
  KICK_MEMBERS: "Mitglieder kicken",
  BAN_MEMBERS: "Mitglieder bannen",
  CREATE_INVITES: "Einladungen erstellen",
  VIEW_CHANNELS: "Kanäle sehen",
  SEND_MESSAGES: "Nachrichten schreiben",
  MANAGE_MESSAGES: "Fremde Nachrichten löschen",
  CONNECT_VOICE: "Sprachkanäle betreten",
  ATTACH_FILES: "Dateien anhängen",
  STREAM_VIDEO: "Kamera und Bildschirm teilen",
  MODERATE_VOICE: "Sprachkanäle moderieren (verschieben, Kamera/Bildschirm beenden, Streamen sperren)",
};

/**
 * Standardrolle "Gast" (bekommt jeder beim Beitritt): nur Kanaele sehen und Sprachkanaele betreten.
 * Entscheidung des Nutzers vom 13.09.2026. Alles Weitere ueber die Rolle "Mitglied", die Admins vergeben.
 */
export const DEFAULT_EVERYONE_PERMISSIONS = Permission.VIEW_CHANNELS | Permission.CONNECT_VOICE;

/** Rolle "Mitglied" (wird beim ersten Start angelegt, nicht automatisch vergeben): schreiben, anhaengen, einladen, Kamera/Bildschirm. */
export const DEFAULT_MEMBER_PERMISSIONS =
  DEFAULT_EVERYONE_PERMISSIONS | Permission.SEND_MESSAGES | Permission.ATTACH_FILES | Permission.CREATE_INVITES | Permission.STREAM_VIDEO;

export const ALL_PERMISSIONS = Object.values(Permission).reduce((a, b) => a | b, 0);

export function hasPermission(mask: number, perm: number): boolean {
  return (mask & Permission.ADMINISTRATOR) !== 0 || (mask & perm) === perm;
}

export function permissionNames(mask: number): PermissionName[] {
  return (Object.keys(Permission) as PermissionName[]).filter((k) => (mask & Permission[k]) !== 0);
}
