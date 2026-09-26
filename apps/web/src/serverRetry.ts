import { ApiError } from "./api";

/**
 * A server this device has a session on did not answer (docs/features/offline.md): pure rules for the connection's
 * retries, so that the client shows a notice instead of the login and comes back by itself.
 */

/**
 * Did the server refuse the stored session (its answer, 4xx: signed out elsewhere, expired, account gone), as opposed to not
 * answering at all (network error, a proxy's 502/503, a rate limit)? Only a refusal drops the session; everything else keeps
 * it and tries again later.
 */
export function sessionRejected(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status < 400 || err.status >= 500) return false;
  // Timeouts and limits are the server's mood of the moment, not a word about the session.
  return err.status !== 408 && err.status !== 425 && err.status !== 429;
}

/**
 * Retry cadence (user's wish, 26 September 2026): the first try 15 s after the failure, the 2nd to 5th 30 s after the one
 * before, from then on a minute each.
 */
export const RETRY_DELAYS_MS = { first: 15_000, early: 30_000, later: 60_000 } as const;

/** Delay before try number `attempt` (1 = the first try after the first failure). */
export function retryDelayFor(attempt: number): number {
  return attempt <= 1 ? RETRY_DELAYS_MS.first : attempt <= 5 ? RETRY_DELAYS_MS.early : RETRY_DELAYS_MS.later;
}
