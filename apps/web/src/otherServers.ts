import type { ServerConnState } from "./serverConnection";

/** How many other servers the notice of an unreachable server offers (user's wish, 26 September 2026: up to five). */
export const OTHER_SERVERS_MAX = 5;

export type OtherServer = { key: string; name: string; iconUrl: string | null };

/** How long "Erneut versuchen" rests after a try started (user's wish, 26 September 2026: five seconds). */
export const RETRY_LOCK_MS = 5000;

/**
 * Is the retry button still resting? `startedAt` = when the last try started (null = none yet); `tryRunning` = that try has
 * not finished yet. The button comes back after 5 s at the earliest, and never before the running try is through.
 */
export function retryLocked(startedAt: number | null, now: number, tryRunning: boolean): boolean {
  return tryRunning || (startedAt !== null && now - startedAt < RETRY_LOCK_MS);
}

/**
 * The servers a user can switch to while the one on screen does not answer (docs/features/offline.md): those with a live
 * connection, by name, at most `max`, never the one on screen. Pure, tested.
 */
export function reachableServers(servers: Readonly<Record<string, ServerConnState>>, except: string, iconOf: (key: string) => string | null = () => null, max = OTHER_SERVERS_MAX): OtherServer[] {
  return Object.entries(servers)
    .filter(([key, s]) => key !== except && s.connection === "connected" && s.server !== null)
    .map(([key, s]) => ({ key, name: s.server?.settings.name ?? s.serverName ?? s.host, iconUrl: iconOf(key) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, max);
}

/** Seconds until `at` (a timestamp), never below zero; null = no time set. */
export function secondsUntil(at: number | null, now: number): number | null {
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
}
