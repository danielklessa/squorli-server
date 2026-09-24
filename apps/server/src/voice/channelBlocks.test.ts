import { describe, expect, it } from "vitest";
import { ChannelBlocks, type BlockEntry, type BlockStorage } from "./channelBlocks";

function fakeStorage(initial: BlockEntry[] = []) {
  const rows = new Map(initial.map((e) => [`${e.channelId}:${e.userId}`, e]));
  const storage: BlockStorage = {
    load: async () => [...rows.values()],
    put: async (e) => { rows.set(`${e.channelId}:${e.userId}`, e); },
    remove: async (c, u) => { rows.delete(`${c}:${u}`); },
    removeUser: async (u) => { for (const [k, e] of rows) if (e.userId === u) rows.delete(k); },
  };
  return { rows, storage };
}

const MIN = 60_000;

describe("channel blocks", () => {
  it("keeps a member out of that one channel until the block runs out", async () => {
    const store = new ChannelBlocks(); const { rows, storage } = fakeStorage(); await store.attach(storage, 0);
    await store.set({ channelId: "c", userId: "u", ms: 5 * MIN, source: "moderator", blockedBy: "mod" }, 0);
    expect(store.of("c", "u", 1)?.until).toBe(5 * MIN);
    expect(store.of("other", "u", 1)).toBeNull();
    expect(store.of("c", "someone", 1)).toBeNull();
    expect(rows.size).toBe(1);
    expect(store.of("c", "u", 5 * MIN + 1)).toBeNull();
    await Promise.resolve();
    expect(rows.size).toBe(0); // a block that ran out goes from the table too
  });

  it("keeps a permanent block for good and across a restart", async () => {
    const first = new ChannelBlocks(); const { storage } = fakeStorage(); await first.attach(storage, 0);
    await first.set({ channelId: "c", userId: "u", ms: null, source: "moderator", blockedBy: null }, 0);
    const second = new ChannelBlocks(); await second.attach(storage, 10 ** 12);
    expect(second.of("c", "u", 10 ** 12)?.until).toBeNull();
  });

  it("drops blocks that ran out while the server was down", async () => {
    const { rows, storage } = fakeStorage([{ channelId: "c", userId: "u", until: 100, source: "votekick", blockedBy: null, createdAt: 0 }]);
    const store = new ChannelBlocks(); await store.attach(storage, 200);
    expect(store.all(200)).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it("lifts, replaces and clears", async () => {
    const store = new ChannelBlocks(); const { rows, storage } = fakeStorage(); await store.attach(storage, 0);
    await store.set({ channelId: "c", userId: "u", ms: 5 * MIN, source: "votekick", blockedBy: null }, 0);
    await store.set({ channelId: "c", userId: "u", ms: null, source: "moderator", blockedBy: "mod" }, 0);
    expect(store.of("c", "u", 1)).toMatchObject({ until: null, source: "moderator" });
    expect(await store.lift("c", "u", 1)).toBe(true);
    expect(await store.lift("c", "u", 1)).toBe(false);
    expect(rows.size).toBe(0);
    await store.set({ channelId: "c", userId: "u", ms: null, source: "moderator", blockedBy: null }, 0);
    await store.set({ channelId: "d", userId: "u", ms: null, source: "moderator", blockedBy: null }, 0);
    await store.set({ channelId: "d", userId: "v", ms: null, source: "moderator", blockedBy: null }, 0);
    await store.clearUser("u");
    expect(store.all(1).map((e) => e.userId)).toEqual(["v"]);
    store.clearChannel("d");
    expect(store.all(1)).toEqual([]);
  });
});
