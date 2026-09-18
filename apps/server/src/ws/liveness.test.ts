import { describe, expect, it } from "vitest";
import { DEAD_AFTER_MS, Liveness, STALE_AFTER_MS } from "./liveness";

describe("Liveness", () => {
  it("calls a connection dead once nothing at all was heard for DEAD_AFTER_MS", () => {
    let now = 0;
    const l = new Liveness<string>(() => now);
    l.add("a"); l.add("b");
    now = DEAD_AFTER_MS - 1;
    l.heard("b", false);
    expect(l.sweep().dead).toEqual([]);
    now = DEAD_AFTER_MS;
    expect(l.sweep().dead).toEqual(["a"]);
    l.remove("a");
    expect(l.sweep().dead).toEqual([]);
  });

  it("calls a connection stale when only pongs arrive, once, until the client speaks again", () => {
    let now = 0;
    const l = new Liveness<string>(() => now);
    l.add("a");
    for (now = 30_000; now < STALE_AFTER_MS; now += 30_000) { l.heard("a", false); expect(l.sweep()).toEqual({ dead: [], stale: [] }); }
    now = STALE_AFTER_MS;
    l.heard("a", false);
    expect(l.sweep()).toEqual({ dead: [], stale: ["a"] });
    expect(l.sweep()).toEqual({ dead: [], stale: [] });
    expect(l.heard("a", false)).toBe(false);
    expect(l.heard("a", true)).toBe(true);
    expect(l.heard("a", true)).toBe(false);
  });

  it("a client that keeps sending is neither", () => {
    let now = 0;
    const l = new Liveness<string>(() => now);
    l.add("a");
    for (now = 60_000; now <= 600_000; now += 60_000) { l.heard("a", true); expect(l.sweep()).toEqual({ dead: [], stale: [] }); }
  });
});
