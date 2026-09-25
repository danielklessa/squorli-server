import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Rate limits on every public path (25 September 2026, docs/PLAN.md 2.1; docs/features/rate-limits.md). One `onRequest` hook
 * counts before any route runs, so a refused request costs no database work: fixed windows per client IP (behind
 * `TRUSTED_PROXIES`, `req.ip` is the real client) and per session token (hashed, never kept as is). The limits are generous
 * for a person and tight for a script; `RATE_LIMIT_FACTOR` scales all of them (0 switches them off, e.g. for load tests).
 * The routes of server accounts keep their own, stricter limits (auth/local.ts); slowmode stays per channel (messages.ts).
 */

/** Counting window per key: `limit` hits per `windowMs`, O(1) per hit. */
export class WindowCounter {
  private readonly windows = new Map<string, { start: number; n: number }>();
  constructor(readonly limit: number, readonly windowMs = 60_000) {}

  /** Count a hit; false (and the seconds until the window ends) once the limit is reached. */
  hit(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, n: 0 };
      this.windows.set(key, w);
    }
    if (w.n >= this.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000)) };
    w.n++;
    return { ok: true };
  }
  sweep(now = Date.now()) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
  get size() { return this.windows.size; }
}

type Rule = { name: string; counter: WindowCounter; by: "ip" | "token"; applies: (method: string, path: string) => boolean };

/** The limits at factor 1: hits per window. */
export const LIMITS = {
  /** Everything under /api per IP: many people behind one address (a household, a company, carrier NAT) share it. */
  ipAll: { limit: 1200, windowMs: 60_000 },
  /** Challenge + verify per IP: a sign-in costs two, so 30 sign-ins a minute; every fresh key asks the directory. */
  ipAuth: { limit: 60, windowMs: 60_000 },
  /** Opening the WebSocket per IP (each reconnect is one). */
  ipWs: { limit: 60, windowMs: 60_000 },
  /** The public invite preview per IP. */
  ipInvite: { limit: 30, windowMs: 60_000 },
  /** The status API per IP (it caches for a second anyway). */
  ipStatus: { limit: 60, windowMs: 60_000 },
  /** The directory's pushes (notify, leave) per IP: they carry no proof and each one makes this server ask the directory. */
  ipDirectoryPush: { limit: 120, windowMs: 60_000 },
  /** Every writing request per session. */
  tokenWrite: { limit: 180, windowMs: 60_000 },
  /** Messages per session, over all channels. */
  tokenMessages: { limit: 15, windowMs: 10_000 },
  /** Uploads per session. */
  tokenUploads: { limit: 30, windowMs: 60_000 },
  /** Events on one WebSocket (typing, activity, voice state, ping). */
  wsEvents: { limit: 60, windowMs: 10_000 },
} as const;

const scaled = (l: { limit: number; windowMs: number }, factor: number) => new WindowCounter(Math.max(1, Math.round(l.limit * factor)), l.windowMs);
const isWrite = (m: string) => m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";

/** The session token of a request, hashed (the key must not be the secret itself). */
function tokenKey(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return createHash("sha256").update(h.slice(7)).digest("base64url").slice(0, 22);
}

export function buildRules(factor: number): Rule[] {
  const r = (name: keyof typeof LIMITS, by: Rule["by"], applies: Rule["applies"]): Rule => ({ name, counter: scaled(LIMITS[name], factor), by, applies });
  return [
    r("ipAll", "ip", () => true),
    r("ipAuth", "ip", (m, p) => m === "POST" && (p === "/api/auth/challenge" || p === "/api/auth/verify")),
    r("ipWs", "ip", (m, p) => m === "GET" && p === "/api/ws"),
    r("ipInvite", "ip", (m, p) => m === "GET" && p.startsWith("/api/invites/")),
    r("ipStatus", "ip", (m, p) => m === "GET" && p === "/api/status"),
    r("ipDirectoryPush", "ip", (m, p) => m === "POST" && (p === "/api/directory/notify" || p === "/api/directory/leave")),
    r("tokenWrite", "token", (m) => isWrite(m)),
    r("tokenMessages", "token", (m, p) => m === "POST" && /^\/api\/channels\/[^/]+\/messages$/.test(p)),
    r("tokenUploads", "token", (m, p) => m === "POST" && p === "/api/attachments"),
  ];
}

/** Register the hook. Returns a counter for WebSocket events, or null when the limits are off. */
export function registerRateLimits(app: FastifyInstance, factor: number): (() => WindowCounter) | null {
  if (!(factor > 0)) {
    app.log.warn("RATE_LIMIT_FACTOR=0: keine Rate-Limits");
    return null;
  }
  const rules = buildRules(factor);
  const sweeper = setInterval(() => { for (const rule of rules) rule.counter.sweep(); }, 60_000);
  sweeper.unref();
  app.addHook("onClose", async () => clearInterval(sweeper));
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?", 1)[0] ?? "";
    if (!path.startsWith("/api/")) return;
    let token: string | null | undefined;
    for (const rule of rules) {
      if (!rule.applies(req.method, path)) continue;
      let key: string;
      if (rule.by === "ip") key = req.ip;
      else {
        if (token === undefined) token = tokenKey(req);
        if (!token) continue; // without a token the route refuses anyway; the IP rules still count it
        key = token;
      }
      const res = rule.counter.hit(key);
      if (!res.ok) {
        req.log.warn({ rule: rule.name, ip: req.ip, path }, "Rate-Limit erreicht");
        return reply.code(429).header("retry-after", String(res.retryAfter)).send({ error: "rate_limited", retryAfter: res.retryAfter });
      }
    }
  });
  const ws = LIMITS.wsEvents;
  return () => scaled(ws, factor);
}
