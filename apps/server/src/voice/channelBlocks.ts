import type { ChannelBlockSource } from "@squorli/protocol";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { channelBlocks } from "../db/schema";

/**
 * Channel blocks (docs/features/channel-blocks.md, 24 September 2026): who may not enter which voice channel, until when.
 * The table `channel_blocks` is the truth (a permanent block survives a restart); this keeps a copy in memory so the token
 * route and `voice.join` ask without a query. Single node, like `VoicePresence`. A block that ran out is dropped when it
 * is next asked about (and from the table at the next start).
 */

export type BlockEntry = { channelId: string; userId: string; until: number | null; source: ChannelBlockSource; blockedBy: string | null; createdAt: number };

/** What the store writes through; the tests give it a fake. */
export type BlockStorage = {
  load(): Promise<BlockEntry[]>;
  put(e: BlockEntry): Promise<void>;
  remove(channelId: string, userId: string): Promise<void>;
  removeUser(userId: string): Promise<void>;
};

const key = (channelId: string, userId: string) => `${channelId}:${userId}`;
const live = (e: BlockEntry, now: number) => e.until === null || e.until > now;

export class ChannelBlocks {
  private readonly entries = new Map<string, BlockEntry>();
  private storage: BlockStorage | null = null;

  /** Reads the table once at start; blocks that ran out meanwhile are removed from it. */
  async attach(storage: BlockStorage, now = Date.now()): Promise<void> {
    this.storage = storage;
    this.entries.clear();
    for (const e of await storage.load()) {
      if (live(e, now)) this.entries.set(key(e.channelId, e.userId), e);
      else await storage.remove(e.channelId, e.userId);
    }
  }

  /** The running block of a member in a channel, or null. Asked at the token and at `voice.join`. */
  of(channelId: string, userId: string, now = Date.now()): BlockEntry | null {
    const e = this.entries.get(key(channelId, userId));
    if (!e) return null;
    if (live(e, now)) return e;
    this.entries.delete(key(channelId, userId));
    void this.storage?.remove(channelId, userId).catch(() => {});
    return null;
  }

  /** Every running block (the list for moderators; the route filters by channel). */
  all(now = Date.now()): BlockEntry[] {
    return [...this.entries.values()].filter((e) => this.of(e.channelId, e.userId, now) !== null);
  }

  /** Sets or replaces the block of a member in a channel; `ms` null = permanent. */
  async set(i: { channelId: string; userId: string; ms: number | null; source: ChannelBlockSource; blockedBy: string | null }, now = Date.now()): Promise<BlockEntry> {
    const e: BlockEntry = { channelId: i.channelId, userId: i.userId, until: i.ms === null ? null : now + i.ms, source: i.source, blockedBy: i.blockedBy, createdAt: now };
    await this.storage?.put(e);
    this.entries.set(key(i.channelId, i.userId), e);
    return e;
  }

  /** Lifts a block; false = there was none running. */
  async lift(channelId: string, userId: string, now = Date.now()): Promise<boolean> {
    const had = this.of(channelId, userId, now) !== null;
    this.entries.delete(key(channelId, userId));
    await this.storage?.remove(channelId, userId);
    return had;
  }

  /** A kick or ban clears the member's blocks (like their channel overwrites); a deleted channel's rows go by cascade. */
  async clearUser(userId: string): Promise<void> {
    for (const [k, e] of this.entries) if (e.userId === userId) this.entries.delete(k);
    await this.storage?.removeUser(userId);
  }

  clearChannel(channelId: string): void {
    for (const [k, e] of this.entries) if (e.channelId === channelId) this.entries.delete(k);
  }
}

/** The one instance; attached to the database at start (index.ts). */
export const channelBlockStore = new ChannelBlocks();

export function dbBlockStorage(db: Db): BlockStorage {
  return {
    async load() {
      const rows = await db.select().from(channelBlocks);
      return rows.map((r) => ({ channelId: r.channelId, userId: r.userId, until: r.until ? r.until.getTime() : null, source: r.source, blockedBy: r.blockedBy, createdAt: r.createdAt.getTime() }));
    },
    async put(e) {
      const row = { channelId: e.channelId, userId: e.userId, until: e.until === null ? null : new Date(e.until), source: e.source, blockedBy: e.blockedBy, createdAt: new Date(e.createdAt) };
      await db.insert(channelBlocks).values(row).onConflictDoUpdate({ target: [channelBlocks.channelId, channelBlocks.userId], set: { until: row.until, source: row.source, blockedBy: row.blockedBy, createdAt: row.createdAt } });
    },
    async remove(channelId, userId) {
      await db.delete(channelBlocks).where(and(eq(channelBlocks.channelId, channelId), eq(channelBlocks.userId, userId)));
    },
    async removeUser(userId) {
      await db.delete(channelBlocks).where(eq(channelBlocks.userId, userId));
    },
  };
}
