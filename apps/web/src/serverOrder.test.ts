import { SERVER_ORDER_MAX } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { moveInOrder, normalizeServerOrder, sameServerOrder, sortByServerOrder } from "./serverOrder";

describe("server order", () => {
  it("normalizes a stored order: lower case, no repeats, nothing empty or overlong, capped", () => {
    expect(normalizeServerOrder(["B.example", " a.example ", "b.example", "", 7, "x".repeat(254)])).toEqual(["b.example", "a.example"]);
    expect(normalizeServerOrder(null)).toEqual([]);
    expect(normalizeServerOrder(Array.from({ length: SERVER_ORDER_MAX + 5 }, (_, i) => `s${i}.example`))).toHaveLength(SERVER_ORDER_MAX);
  });

  it("puts the placed servers first in their order and keeps the rest in the default order", () => {
    const entries = [{ host: "home.example" }, { host: "new.example" }, { host: "old.example" }, { host: "added.example" }];
    expect(sortByServerOrder(entries, ["old.example", "gone.example", "HOME.example"]).map((e) => e.host)).toEqual(["old.example", "home.example", "new.example", "added.example"]);
    expect(sortByServerOrder(entries, []).map((e) => e.host)).toEqual(entries.map((e) => e.host));
  });

  it("moves an entry in front of another, or to the end", () => {
    const hosts = ["a", "b", "c", "d"];
    expect(moveInOrder(hosts, 0, 3)).toEqual(["b", "c", "a", "d"]);
    expect(moveInOrder(hosts, 0, 4)).toEqual(["b", "c", "d", "a"]);
    expect(moveInOrder(hosts, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveInOrder(hosts, 2, 1)).toEqual(["a", "c", "b", "d"]);
    // In front of itself or of its follower = no move.
    expect(moveInOrder(hosts, 1, 1)).toEqual(hosts);
    expect(moveInOrder(hosts, 1, 2)).toEqual(hosts);
    expect(moveInOrder(hosts, 5, 0)).toEqual(hosts);
  });

  it("compares orders", () => {
    expect(sameServerOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameServerOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameServerOrder(undefined, [])).toBe(false);
    expect(sameServerOrder(undefined, undefined)).toBe(true);
  });
});
