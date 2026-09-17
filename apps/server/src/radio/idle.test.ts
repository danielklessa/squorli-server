import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RadioIdleStop } from "./idle";
import { lookupYoutube, readOembed } from "./youtube";

describe("radio idle stop", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stops a channel that stayed empty for the whole delay, once", () => {
    const stopped: string[] = [];
    const idle = new RadioIdleStop((id) => stopped.push(id), 120_000);
    idle.sync(["a"]);
    vi.advanceTimersByTime(119_000);
    idle.sync(["a"]); // the periodic check must not restart the clock
    expect(stopped).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(stopped).toEqual(["a"]);
    vi.advanceTimersByTime(500_000);
    expect(stopped).toEqual(["a"]);
  });

  it("forgets a channel somebody came back to, and gives it the full delay the next time", () => {
    const stopped: string[] = [];
    const idle = new RadioIdleStop((id) => stopped.push(id), 120_000);
    idle.sync(["a", "b"]);
    vi.advanceTimersByTime(100_000);
    idle.sync(["b"]); // somebody joined a
    vi.advanceTimersByTime(20_000);
    expect(stopped).toEqual(["b"]);
    idle.sync(["a"]); // and left again
    vi.advanceTimersByTime(119_000);
    expect(stopped).toEqual(["b"]);
    vi.advanceTimersByTime(1_000);
    expect(stopped).toEqual(["b", "a"]);
  });

  it("does nothing while the setting is off (empty list) or after close", () => {
    const stopped: string[] = [];
    const idle = new RadioIdleStop((id) => stopped.push(id), 1_000);
    idle.sync(["a"]);
    idle.sync([]);
    vi.advanceTimersByTime(5_000);
    idle.sync(["a"]);
    idle.close();
    vi.advanceTimersByTime(5_000);
    expect(stopped).toEqual([]);
  });
});

describe("youtube lookup", () => {
  it("reads the title and tells missing from not embeddable videos", () => {
    expect(readOembed(200, { title: "  Big Buck Bunny  " })).toEqual({ ok: true, title: "Big Buck Bunny" });
    expect(readOembed(200, { title: "x".repeat(300) })).toEqual({ ok: true, title: "x".repeat(100) });
    expect(readOembed(200, "nonsense")).toEqual({ ok: true, title: null });
    expect(readOembed(401, null)).toEqual({ ok: false, error: "not_embeddable" });
    expect(readOembed(403, null)).toEqual({ ok: false, error: "not_embeddable" });
    expect(readOembed(404, null)).toEqual({ ok: false, error: "unknown_video" });
    expect(readOembed(400, null)).toEqual({ ok: false, error: "unknown_video" });
    expect(readOembed(500, null)).toEqual({ ok: true, title: null });
  });

  it("asks only YouTube's fixed address and does not refuse a video because YouTube is unreachable from here", async () => {
    const asked: string[] = [];
    const ok = await lookupYoutube("aqz-KE-bpKQ", (async (url: string) => { asked.push(url); return new Response(JSON.stringify({ title: "T" }), { status: 200 }); }) as typeof fetch);
    expect(ok).toEqual({ ok: true, title: "T" });
    expect(asked).toEqual(["https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daqz-KE-bpKQ"]);
    expect(await lookupYoutube("aqz-KE-bpKQ", (async () => { throw new Error("offline"); }) as typeof fetch)).toEqual({ ok: true, title: null });
  });
});
