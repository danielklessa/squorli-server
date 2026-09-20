import { twitchChannelOf } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { isTwitchPlayerSignal, twitchAudioCommands, twitchIsIdle, twitchPlayCommand, twitchPlaybackEvent, twitchPlayerBox, twitchPlayerSrc, twitchStreamEvent } from "./twitch";

describe("twitch as a radio source", () => {
  it("recognizes channel pages and nothing else", () => {
    expect(twitchChannelOf("https://www.twitch.tv/RocketBeansTV")).toBe("rocketbeanstv");
    expect(twitchChannelOf(" https://twitch.tv/some_channel/ ")).toBe("some_channel");
    expect(twitchChannelOf("https://m.twitch.tv/abc?x=1")).toBe("abc");
    for (const url of ["https://www.twitch.tv/", "https://www.twitch.tv/videos/123", "https://www.twitch.tv/directory", "https://www.twitch.tv/name/clip/x", "https://clips.twitch.tv/name",
      "https://nottwitch.tv/name", "https://twitch.tv.evil.example/name", "ftp://twitch.tv/name", "https://www.twitch.tv/na me", "kein link"]) expect(twitchChannelOf(url), url).toBeNull();
  });

  it("builds the official player's address for this page", () => {
    const src = new URL(twitchPlayerSrc("rocketbeanstv", "chat.example.org"));
    expect(src.origin).toBe("https://player.twitch.tv");
    expect(Object.fromEntries(src.searchParams)).toEqual({ channel: "rocketbeanstv", parent: "chat.example.org", autoplay: "true", muted: "true" });
  });

  it("reads playing and paused from the player's events and knows the command that starts it again", () => {
    expect(twitchPlayCommand()).toEqual({ eventName: 3, params: null, namespace: "twitch-embed-player-proxy" });
    expect(["playing", "play", "video.play"].map((eventName) => twitchPlaybackEvent({ namespace: "twitch-embed", eventName }))).toEqual(["playing", "playing", "playing"]);
    expect(["pause", "video.pause"].map((eventName) => twitchPlaybackEvent({ namespace: "twitch-embed", eventName }))).toEqual(["paused", "paused"]);
    for (const data of [null, "pause", { namespace: "other", eventName: "pause" }, { namespace: "twitch-embed", eventName: "offline" }, { namespace: "twitch-embed-player-proxy", eventName: "UPDATE_STATE" }]) expect(twitchPlaybackEvent(data)).toBeNull();
  });

  it("sets the volume before it unmutes, and treats volume 0 and deafen as muted", () => {
    expect(twitchAudioCommands(0.05, false).map((c) => [c.eventName, c.params])).toEqual([[11, 0.05], [10, false]]);
    expect(twitchAudioCommands(0.5, true).map((c) => [c.eventName, c.params])).toEqual([[11, 0.5], [10, true]]);
    expect(twitchAudioCommands(0, false).map((c) => [c.eventName, c.params])).toEqual([[11, 0], [10, true]]);
    expect(twitchAudioCommands(7, false)[0]!.params).toBe(1);
    expect(twitchAudioCommands(Number.NaN, false)[0]!.params).toBe(0);
    expect(twitchAudioCommands(0.3, false).every((c) => c.namespace === "twitch-embed-player-proxy")).toBe(true);
  });

  it("lays the player over a tile that is big enough, otherwise floats it in the corner at the smallest size Twitch plays at", () => {
    const viewport = { width: 1280, height: 720 };
    expect(twitchPlayerBox({ left: 100.4, top: 50, width: 640, height: 360 }, viewport)).toEqual({ left: 100, top: 50, width: 640, height: 360, floating: false });
    const corner = { left: 1280 - 320 - 12, top: 720 - 180 - 12, width: 320, height: 180, floating: true };
    expect(twitchPlayerBox(null, viewport)).toEqual(corner); // a text channel is showing
    expect(twitchPlayerBox({ left: 0, top: 0, width: 176, height: 99 }, viewport)).toEqual(corner); // a tile of the speaker view's strip
    expect(twitchPlayerBox({ left: 0, top: 0, width: 400, height: 170 }, viewport)).toEqual(corner);
    expect(twitchPlayerBox(null, { width: 300, height: 150 })).toMatchObject({ left: 0, top: 0, floating: true }); // never off screen
  });

  it("sees a player that sits there without playing", () => {
    const state = (playback: unknown) => ({ namespace: "twitch-embed-player-proxy", eventName: "UPDATE_STATE", params: { playback } });
    expect(["Idle", "Ready", "Ended", "Playing", "Buffering"].map((p) => twitchIsIdle(state(p)))).toEqual([true, true, true, false, false]);
    for (const data of [null, state(undefined), { namespace: "twitch-embed", eventName: "pause" }]) expect(twitchIsIdle(data)).toBeNull();
  });

  it("knows the player's signs of life", () => {
    expect(isTwitchPlayerSignal({ namespace: "twitch-embed-player-proxy", eventName: "UPDATE_STATE", params: {} })).toBe(true);
    expect(isTwitchPlayerSignal({ namespace: "twitch-embed", eventName: "video.ready" })).toBe(true);
    for (const data of [null, "ready", { namespace: "other", eventName: "ready" }, { namespace: "twitch-embed", eventName: "offline" }]) expect(isTwitchPlayerSignal(data)).toBe(false);
  });

  it("reads from the player whether the stream is there", () => {
    expect(["offline", "ended", "online"].map((eventName) => twitchStreamEvent({ namespace: "twitch-embed", eventName }))).toEqual(["offline", "offline", "online"]);
    for (const data of [null, "offline", { namespace: "other", eventName: "offline" }, { namespace: "twitch-embed", eventName: "ready" }, { namespace: "twitch-embed-player-proxy", eventName: "UPDATE_STATE", params: { playback: "Idle" } }]) expect(twitchStreamEvent(data)).toBeNull();
  });
});
