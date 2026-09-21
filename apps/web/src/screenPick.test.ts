import { describe, expect, it } from "vitest";
import type { ScreenSource } from "./platform/bridge";
import { defaultAudio, defaultCodec, quickSharePick, sortWindows } from "./screenPick";

const source = (over: Partial<ScreenSource>): ScreenSource => ({ id: "window:1:0", kind: "window", name: "x", thumbnail: "", icon: null, audio: true, ...over });

describe("screenPick", () => {
  it("ticks a window's audio, never the app's own and not a screen's", () => {
    expect(defaultAudio(source({}))).toBe(true);
    expect(defaultAudio(source({ audio: false }))).toBe(false);
    expect(defaultAudio(source({ id: "screen:0:0", kind: "screen" }))).toBe(false);
    expect(defaultAudio(null)).toBe(false);
  });

  it("preselects H.264 for a game's window and the standing codec for everything else", () => {
    expect(defaultCodec(source({ gameId: "steam:730" }))).toBe("h264");
    expect(defaultCodec(source({}))).toBe("vp8");
    expect(defaultCodec(source({ gameId: null }))).toBe("vp8");
    expect(defaultCodec(source({ id: "screen:0:0", kind: "screen" }))).toBe("vp8");
    expect(defaultCodec(null)).toBe("vp8");
  });

  it("lists games first, then full screen windows, then the rest, each by name", () => {
    const list = [source({ name: "zeta" }), source({ name: "Video", fullscreen: true }), source({ name: "Alpha" }), source({ name: "Witcher", gameId: "gog:1" }), source({ name: "apex", gameId: "steam:1", fullscreen: true }), source({ name: "Browser", fullscreen: true })];
    expect(sortWindows(list, "de").map((s) => s.name)).toEqual(["apex", "Witcher", "Browser", "Video", "Alpha", "zeta"]);
    expect(list[0]!.name).toBe("zeta");
  });

  it("quick share takes the game's topmost window with audio and H.264", () => {
    const sources = [source({ id: "screen:0:0", kind: "screen" }), source({ id: "window:5:0" }), source({ id: "window:7:0", gameId: "steam:730" }), source({ id: "window:9:0", gameId: "steam:730" })];
    expect(quickSharePick(sources, "steam:730")).toEqual({ sourceId: "window:7:0", audio: true, codec: "h264" });
    expect(quickSharePick([source({ id: "window:7:0", gameId: "steam:730", audio: false })], "steam:730")).toEqual({ sourceId: "window:7:0", audio: false, codec: "h264" });
    expect(quickSharePick(sources, "epic:Fortnite")).toBeNull();
  });
});
