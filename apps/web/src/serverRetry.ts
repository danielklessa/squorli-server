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

/**
 * How many tries run by themselves (user's wish, 26 September 2026): ten after a failure, then the automatic tries stop
 * until the user presses "Erneut versuchen"; after that press five more, a minute apart, then they stop again.
 */
export const AUTO_TRIES = 10;
export const TRIES_AFTER_USER = 5;

/** The plan of automatic tries for one silent spell: which phase, how many failed so far, how many are left. */
export type RetryPlan = { phase: "auto" | "user"; failed: number; left: number };

/** The server answered (or nothing went wrong yet): ten automatic tries in the ordinary cadence. */
export function freshPlan(): RetryPlan {
  return { phase: "auto", failed: 0, left: AUTO_TRIES };
}

/** The user pressed "Erneut versuchen": five automatic tries follow, a minute apart. */
export function planAfterUser(): RetryPlan {
  return { phase: "user", failed: 0, left: TRIES_AFTER_USER };
}

/** A try failed: the delay before the next automatic one, or null when the plan is used up (the user has to press). */
export function nextTry(plan: RetryPlan): { plan: RetryPlan; delay: number | null } {
  if (plan.left <= 0) return { plan, delay: null };
  const failed = plan.failed + 1;
  return { plan: { phase: plan.phase, failed, left: plan.left - 1 }, delay: plan.phase === "user" ? RETRY_DELAYS_MS.later : retryDelayFor(failed) };
}
