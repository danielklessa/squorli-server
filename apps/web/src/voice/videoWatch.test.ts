import { describe, expect, it } from "vitest";
import { VideoWatch, parseFeedId, videoActive } from "./videoWatch";

describe("VideoWatch", () => {
  it("watches cameras by default and screen shares only when turned on", () => {
    const w = new VideoWatch();
    expect(w.watching("a", "camera")).toBe(true);
    expect(w.watching("a", "screen")).toBe(false);
  });
  it("keeps a choice per feed", () => {
    const w = new VideoWatch();
    w.set("a", "screen", true); w.set("a", "camera", false);
    expect(w.watching("a", "screen")).toBe(true);
    expect(w.watching("a", "camera")).toBe(false);
    expect(w.watching("b", "screen")).toBe(false);
    expect(w.watching("b", "camera")).toBe(true);
  });
  it("forgets the choice when the feed ends, the participant leaves or the connection ends", () => {
    const w = new VideoWatch();
    w.set("a", "screen", true); w.forget("a", "screen");
    expect(w.watching("a", "screen")).toBe(false);
    w.set("a", "screen", true); w.set("a", "camera", false); w.forgetParticipant("a");
    expect(w.watching("a", "screen")).toBe(false);
    expect(w.watching("a", "camera")).toBe(true);
    w.set("b", "camera", false); w.clear();
    expect(w.watching("b", "camera")).toBe(true);
  });
});

describe("parseFeedId", () => {
  it("splits at the last colon", () => {
    expect(parseFeedId("user-1:screen")).toEqual({ identity: "user-1", source: "screen" });
    expect(parseFeedId("bot:7:camera")).toEqual({ identity: "bot:7", source: "camera" });
  });
});

describe("videoActive", () => {
  it("is false without any camera, screen or player", () => {
    expect(videoActive([{ cameraOn: false, screenOn: false }], false)).toBe(false);
    expect(videoActive([], false)).toBe(false);
  });
  it("is true with one camera, one screen or the player tile", () => {
    expect(videoActive([{ cameraOn: false, screenOn: false }, { cameraOn: true, screenOn: false }], false)).toBe(true);
    expect(videoActive([{ cameraOn: false, screenOn: true }], false)).toBe(true);
    expect(videoActive([{ cameraOn: false, screenOn: false }], true)).toBe(true);
  });
});
