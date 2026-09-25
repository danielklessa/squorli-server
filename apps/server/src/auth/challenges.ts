import { randomBytes, randomUUID } from "node:crypto";

/**
 * Short-lived login challenges. In-memory is enough for a single node;
 * for multi-node operation, move this to Redis later.
 */
export class ChallengeStore {
  private readonly items = new Map<string, { publicKey: string; nonce: string; expiresAt: number }>();
  constructor(private readonly ttlMs = 60_000) {}

  create(publicKey: string) {
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + this.ttlMs;
    this.items.set(challengeId, { publicKey, nonce, expiresAt });
    return { challengeId, nonce, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Single-use: returns and deletes. */
  consume(challengeId: string, publicKey: string): string | null {
    const item = this.items.get(challengeId);
    this.items.delete(challengeId);
    if (!item || item.publicKey !== publicKey || item.expiresAt < Date.now()) return null;
    return item.nonce;
  }

  sweep() {
    const now = Date.now();
    for (const [id, item] of this.items) if (item.expiresAt < now) this.items.delete(id);
  }
}

/** Counting window per key (client IP, handle): `limit` hits per `windowMs`, as at the directory. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  allow(key: string): boolean {
    if (this.blocked(key)) return false;
    this.hit(key);
    return true;
  }
  /** Check only, without counting (failed attempts count through hit()). */
  blocked(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list.length >= this.limit;
  }
  hit(key: string) {
    const list = this.hits.get(key) ?? [];
    list.push(Date.now());
    this.hits.set(key, list);
  }
  /**
   * Password checks: count the attempt before the first await, so parallel requests cannot all pass one `blocked()` check
   * (security review, 25 September 2026); a correct password gives the attempt back with `refund()`.
   */
  attempt(...keys: string[]): boolean {
    if (keys.some((k) => this.blocked(k))) return false;
    for (const k of keys) this.hit(k);
    return true;
  }
  refund(...keys: string[]) {
    for (const k of keys) {
      const list = this.hits.get(k);
      if (!list) continue;
      list.pop();
      if (!list.length) this.hits.delete(k);
    }
  }
  sweep() {
    const now = Date.now();
    for (const [k, list] of this.hits) {
      const kept = list.filter((t) => now - t < this.windowMs);
      if (kept.length) this.hits.set(k, kept); else this.hits.delete(k);
    }
  }
}
