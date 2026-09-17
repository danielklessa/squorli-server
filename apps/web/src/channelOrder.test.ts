import { describe, expect, it } from "vitest";
import { reorderItems } from "./channelOrder";

describe("channel and category ordering", () => {
  const items = [{ id: "a", position: 0 }, { id: "b", position: 4 }, { id: "c", position: 8 }];
  it("moves to both ends without mutating the server snapshot", () => {
    expect(reorderItems(items, "a", "c", true).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(reorderItems(items, "c", "a", false).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(items.map((x) => x.position)).toEqual([0, 4, 8]);
  });
  it("inserts immediately before and after a target in either direction", () => {
    expect(reorderItems(items, "a", "c", false).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(reorderItems(items, "c", "a", true).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
  it("repairs duplicate positions and accepts unsorted input", () => {
    const result = reorderItems([{ id: "c", position: 5 }, { id: "a", position: 0 }, { id: "b", position: 0 }], "c", "b", false);
    expect(result).toEqual([{ id: "a", position: 0 }, { id: "c", position: 1 }, { id: "b", position: 2 }]);
  });
  it("ignores stale targets, missing sources and self drops", () => {
    for (const [id, target] of [["a", "gone"], ["gone", "a"], ["a", "a"]] as const) {
      expect(reorderItems(items, id, target, false)).toEqual(items);
    }
  });
});
