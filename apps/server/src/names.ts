import { eq } from "drizzle-orm";
import { localAccounts, users } from "./db/schema";

/**
 * The columns `displayNameOf` needs, including the server account's handle (`~name`, docs/features/local-accounts.md). Select
 * them from `users` with `.leftJoin(localAccounts, localJoin)`.
 */
export const nameColumns = { publicKey: users.publicKey, displayName: users.displayName, handle: users.handle, localHandle: localAccounts.handle };
export const localJoin = eq(localAccounts.userId, users.id);

/** Where the outside reaches this server (config.publicOrigin); set once at startup, for the absolute avatar addresses. */
let origin = "";
export function setPublicOrigin(o: string): void { origin = o.replace(/\/+$/, ""); }

/**
 * The avatar a member shows: a directory account's picture (cached in users.avatar_url) or, for a server account without a
 * directory handle, the picture this server stores itself (docs/features/local-accounts.md). Absolute like the directory's.
 */
export function avatarOf(u: { userId: string; handle: string | null; avatarUrl: string | null; localAvatarAt: Date | null }): string | null {
  if (!u.handle && u.localAvatarAt) return `${origin}/api/avatars/${u.userId}?v=${u.localAvatarAt.getTime()}`;
  return u.avatarUrl;
}
