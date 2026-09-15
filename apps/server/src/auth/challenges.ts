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
