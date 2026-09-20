import { describe, expect, it } from "vitest";
import { pickPlayable } from "./queue";
import type { YoutubeLookup } from "./youtube";

const lookupOf = (bad: string[]) => async (id: string): Promise<YoutubeLookup> => bad.includes(id) ? { ok: false, error: "not_embeddable" } : { ok: true, title: `title of ${id}` };

describe("radio queue", () => {
  it("takes the entry asked for when it can be played", async () => {
    expect(await pickPlayable(["a", "b", "c"], 1, 1, lookupOf([]))).toEqual({ index: 1, title: "title of b" });
  });
  it("skips what cannot be played, in the direction of travel, around the ends", async () => {
    expect(await pickPlayable(["a", "b", "c"], 1, 1, lookupOf(["b", "c"]))).toEqual({ index: 0, title: "title of a" });
    expect(await pickPlayable(["a", "b", "c"], 0, -1, lookupOf(["a"]))).toEqual({ index: 2, title: "title of c" });
    expect(await pickPlayable(["a", "b", "c"], 3, 1, lookupOf([]))).toEqual({ index: 0, title: "title of a" });
    expect(await pickPlayable(["a", "b", "c"], -1, -1, lookupOf([]))).toEqual({ index: 2, title: "title of c" });
  });
  it("gives up when nothing can be played, and asks about no entry twice", async () => {
    const asked: string[] = [];
    expect(await pickPlayable(["a", "b"], 0, 1, async (id) => { asked.push(id); return { ok: false, error: "unknown_video" }; })).toBeNull();
    expect(asked).toEqual(["a", "b"]);
    expect(await pickPlayable([], 0, 1, lookupOf([]))).toBeNull();
    const many = Array.from({ length: 50 }, (_, i) => `v${i}`);
    asked.length = 0;
    expect(await pickPlayable(many, 0, 1, async (id) => { asked.push(id); return { ok: false, error: "unknown_video" }; })).toBeNull();
    expect(asked.length).toBe(10);
  });
});
