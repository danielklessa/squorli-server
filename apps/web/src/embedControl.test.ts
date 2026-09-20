import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TWITCH_OFFLINE_GRACE_MS, TwitchControl, YoutubeControl } from "./embedControl";

const twitchEvent = (eventName: string) => ({ namespace: "twitch-embed", eventName, params: {} });
const twitchState = { namespace: "twitch-embed-player-proxy", eventName: "UPDATE_STATE", params: {} };

describe("twitch control", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup() {
    const posted: { eventName: number; params: unknown }[] = [];
    let hidden = false;
    const blocked = vi.fn();
    const control = new TwitchControl({ post: (data) => posted.push(data as { eventName: number; params: unknown }), isHidden: () => hidden }, blocked);
    return { posted, control, blocked, hide: (h: boolean) => { hidden = h; } };
  }

  it("tells that the stream is over only when it stays away, and once", () => {
    const over = vi.fn();
    const control = new TwitchControl({ post: () => {}, isHidden: () => false }, () => {}, over);
    const event = (eventName: string) => control.onMessage({ namespace: "twitch-embed", eventName });
    event("offline");
    vi.advanceTimersByTime(TWITCH_OFFLINE_GRACE_MS - 1000);
    event("online"); // the streamer's connection dropped for a moment
    vi.advanceTimersByTime(TWITCH_OFFLINE_GRACE_MS);
    expect(over).not.toHaveBeenCalled();
    event("ended"); event("offline");
    vi.advanceTimersByTime(TWITCH_OFFLINE_GRACE_MS);
    expect(over).toHaveBeenCalledTimes(1);
    event("offline");
    control.close(); // the radio went off: a pending report dies with the player
    vi.advanceTimersByTime(TWITCH_OFFLINE_GRACE_MS);
    expect(over).toHaveBeenCalledTimes(1);
  });

  it("sends our volume once the player shows a sign of life, and again when it changes", () => {
    const { posted, control } = setup();
    control.setAudio(0.05, false);
    expect(posted).toEqual([]);
    control.onMessage(twitchState);
    control.onMessage(twitchState); // comes every second: answered once
    expect(posted.map((c) => [c.eventName, c.params])).toEqual([[11, 0.05], [10, false]]);
    control.setAudio(0.05, true);
    expect(posted.slice(2).map((c) => [c.eventName, c.params])).toEqual([[11, 0.05], [10, true]]);
  });

  it("starts the player again when the page is back, after Twitch paused it for being hidden", () => {
    const { posted, control, hide } = setup();
    control.onMessage(twitchEvent("playing"));
    hide(true);
    control.onMessage(twitchEvent("pause"));
    hide(false);
    control.onVisible();
    expect(posted.filter((c) => c.eventName === 3)).toHaveLength(1);
    vi.advanceTimersByTime(1500); // no answer yet: once more
    expect(posted.filter((c) => c.eventName === 3)).toHaveLength(2);
    control.onMessage(twitchEvent("playing"));
    vi.advanceTimersByTime(10_000);
    expect(posted.filter((c) => c.eventName === 3)).toHaveLength(2);
  });

  it("starts a player that came up without playing, but not one the viewer paused", () => {
    const idle = { namespace: "twitch-embed-player-proxy", eventName: "UPDATE_STATE", params: { playback: "Ready" } };
    const { posted, control } = setup();
    control.onMessage(idle);
    vi.advanceTimersByTime(2900);
    expect(posted.filter((c) => c.eventName === 3)).toHaveLength(0); // it may still start by itself
    vi.advanceTimersByTime(200);
    expect(posted.filter((c) => c.eventName === 3)).toHaveLength(1);
    control.onMessage(twitchEvent("playing"));
    control.onMessage(twitchEvent("pause")); // the viewer, visible
    control.onMessage(idle);
    vi.advanceTimersByTime(20_000);
    expect(posted.filter((c) => c.eventName === 3)).toHaveLength(1);
  });

  it("tries muted when the player will not start with sound, and turns the sound on at the next click", () => {
    const { posted, control, blocked } = setup();
    control.setAudio(0.05, false);
    control.onMessage({ namespace: "twitch-embed-player-proxy", eventName: "UPDATE_STATE", params: { playback: "Ready" } });
    vi.advanceTimersByTime(3000 + 1500 + 1500 + 100);
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(posted.slice(-3).map((c) => [c.eventName, c.params])).toEqual([[11, 0.05], [10, true], [3, null]]);
    control.onMessage(twitchEvent("playing"));
    control.onGesture();
    expect(posted.slice(-2).map((c) => [c.eventName, c.params])).toEqual([[11, 0.05], [10, false]]);
  });

  it("gives up after a few tries (the channel went offline) and leaves a player alone the viewer paused", () => {
    const offline = setup();
    offline.control.onVisible();
    vi.advanceTimersByTime(60_000);
    expect(offline.posted.filter((c) => c.eventName === 3)).toHaveLength(4);

    const paused = setup();
    paused.control.onMessage(twitchEvent("playing"));
    paused.control.onMessage(twitchEvent("pause")); // visible: the viewer did that
    paused.hide(true); paused.hide(false);
    paused.control.onVisible();
    expect(paused.posted.filter((c) => c.eventName === 3)).toHaveLength(0);
  });
});

const info = (i: Record<string, unknown>) => JSON.stringify({ event: "infoDelivery", info: i });

describe("youtube control", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(canControl: boolean, publish: (p: unknown) => Promise<unknown> = async () => {}) {
    const posted: { event: string; func?: string; args?: unknown[] }[] = [];
    const published: unknown[] = [];
    const corrected = vi.fn();
    const blocked = vi.fn();
    const errors: string[] = [];
    const control = new YoutubeControl({ post: (data) => posted.push(JSON.parse(data as string)), isHidden: () => false }, {
      serverNow: () => Date.now(), canControl: () => canControl, publish: (p) => { published.push(p); return publish(p); }, onCorrected: corrected, onError: (kind) => errors.push(kind), onSoundBlocked: blocked,
    });
    const commands = () => posted.filter((m) => m.event === "command" && m.func !== "addEventListener").map((m) => [m.func, ...(m.args ?? [])]);
    return { control, posted, published, corrected, blocked, errors, commands };
  }

  it("asks the player to report until it answers, then sets our volume", () => {
    const { control, posted, commands } = setup(false);
    control.setAudio(0.05, false);
    control.start();
    vi.advanceTimersByTime(600);
    expect(posted.filter((m) => m.event === "listening")).toHaveLength(3);
    control.onMessage(JSON.stringify({ event: "onReady" }));
    vi.advanceTimersByTime(2000);
    expect(posted.filter((m) => m.event === "listening")).toHaveLength(3);
    expect(commands()).toEqual([["setVolume", 5], ["unMute"]]);
  });

  it("turns captions off whenever the player says its captions part is there, and not before", () => {
    const { control, posted, commands } = setup(false);
    control.start();
    control.onMessage(JSON.stringify({ event: "initialDelivery", info: {} }));
    expect(posted.filter((m) => m.func === "addEventListener").map((m) => m.args)).toEqual([["onApiChange"]]);
    expect(commands().some((c) => c[0] === "setOption")).toBe(false);
    control.onMessage(JSON.stringify({ event: "onApiChange" }));
    expect(commands().filter((c) => c[0] === "setOption")).toEqual([["setOption", "captions", "track", {}]]);
    control.onMessage(JSON.stringify({ event: "onApiChange" })); // the next video of a queue
    expect(commands().filter((c) => c[0] === "setOption")).toHaveLength(2);
    control.onMessage(info({ playerState: 1, currentTime: 1 }));
    expect(posted.filter((m) => m.func === "addEventListener")).toHaveLength(1);
  });

  it("brings a freshly loaded player to where the video stands for everyone", () => {
    const { control, commands } = setup(true);
    control.setShared({ playing: true, position: 100, rate: 1, at: 1_000_000 - 20_000 }); // stands at 120
    control.onMessage(info({ playerState: 1, currentTime: 100.5, playbackRate: 1, videoData: { isLive: false } }));
    expect(commands().slice(2)).toEqual([["seekTo", 120, true]]);
  });

  it("publishes a controller's pause, and takes the server's echo of it for no news", async () => {
    const { control, published, commands } = setup(true);
    control.setShared({ playing: true, position: 100, rate: 1, at: 1_000_000 });
    control.onMessage(info({ playerState: 1, currentTime: 100, playbackRate: 1 })); // loaded, in step
    vi.advanceTimersByTime(5000);
    control.onMessage(info({ playerState: 2, currentTime: 105.2 }));
    expect(published).toEqual([{ playing: false, position: 105.2, rate: 1 }]);
    await vi.advanceTimersByTimeAsync(400);
    control.setShared({ playing: false, position: 105.2, rate: 1, at: 1_005_050 });
    control.onMessage(info({ currentTime: 105.2 }));
    expect(published).toHaveLength(1);
    expect(commands().filter(([f]) => f === "seekTo" || f === "playVideo" || f === "pauseVideo")).toEqual([]);
  });

  it("follows somebody else's change at once, without publishing the difference as its own", () => {
    const { control, published, commands } = setup(true);
    control.setShared({ playing: true, position: 100, rate: 1, at: 1_000_000 });
    control.onMessage(info({ playerState: 1, currentTime: 100, playbackRate: 1 }));
    vi.advanceTimersByTime(5000);
    control.onMessage(info({ currentTime: 105 }));
    control.setShared({ playing: false, position: 300, rate: 1, at: 1_005_000 });
    expect(commands().slice(2)).toEqual([["seekTo", 300, true], ["pauseVideo"]]);
    control.onMessage(info({ playerState: 3, currentTime: 300 })); // settling: not judged
    control.onMessage(info({ playerState: 2, currentTime: 300 }));
    expect(published).toEqual([]);
  });

  it("undoes a viewer's own pause and tells them, and goes back to the server's state when publishing is refused", async () => {
    const viewer = setup(false);
    viewer.control.setShared({ playing: true, position: 100, rate: 1, at: 1_000_000 });
    viewer.control.onMessage(info({ playerState: 1, currentTime: 100, playbackRate: 1 }));
    vi.advanceTimersByTime(3000);
    viewer.control.onMessage(info({ playerState: 2, currentTime: 103 }));
    expect(viewer.commands().slice(2)).toEqual([["playVideo"]]);
    expect(viewer.corrected).toHaveBeenCalledTimes(1);
    expect(viewer.published).toEqual([]);

    const refused = setup(true, async () => { throw new Error("forbidden"); });
    refused.control.setShared({ playing: true, position: 100, rate: 1, at: Date.now() }); // the clock moved on above
    refused.control.onMessage(info({ playerState: 1, currentTime: 100, playbackRate: 1 }));
    vi.advanceTimersByTime(3000);
    refused.control.onMessage(info({ playerState: 2, currentTime: 103 }));
    await vi.advanceTimersByTimeAsync(400);
    refused.control.onMessage(info({ currentTime: 103 }));
    expect(refused.commands().slice(2)).toEqual([["playVideo"]]);
  });

  it("starts a player muted that the browser will not start with sound, and turns the sound on at the next click", () => {
    const { control, commands, blocked, published } = setup(true);
    control.setAudio(0.05, false);
    control.setShared({ playing: true, position: 100, rate: 1, at: Date.now() });
    control.start();
    control.onMessage(info({ playerState: -1, currentTime: 100, playbackRate: 1 }));
    vi.advanceTimersByTime(6000);
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(commands().filter(([f]) => f === "mute")).toHaveLength(1);
    control.onMessage(info({ playerState: 1, currentTime: 100 })); // muted it plays
    control.setAudio(0.2, false); // moving our slider meanwhile must not unmute it behind the browser's back
    expect(commands().slice(-2)).toEqual([["setVolume", 20], ["mute"]]);
    control.onGesture();
    expect(commands().slice(-2)).toEqual([["setVolume", 20], ["unMute"]]);
    expect(published).toEqual([]);
    vi.advanceTimersByTime(20_000);
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it("loads a queue's next video into the same player, where it stands for everyone, and judges nothing by the old video meanwhile", () => {
    const { control, commands, published } = setup(true);
    control.setVideo("aaaaaaaaaaa"); // what the iframe was made with: nothing to load
    control.setShared({ playing: true, position: 0, rate: 1, at: 1_000_000 });
    control.onMessage(info({ playerState: 1, currentTime: 0, playbackRate: 1, videoData: { isLive: false, video_id: "aaaaaaaaaaa" } }));
    expect(commands().some((c) => c[0] === "loadVideoById")).toBe(false);
    vi.advanceTimersByTime(60_000);
    control.setShared({ playing: true, position: 0, rate: 1, at: 1_060_000 });
    control.setVideo("bbbbbbbbbbb");
    expect(commands().filter((c) => c[0] === "loadVideoById")).toEqual([["loadVideoById", "bbbbbbbbbbb", 0]]);
    // The old video's last words must neither be published nor corrected.
    const before = commands().length;
    control.onMessage(info({ playerState: 2, currentTime: 60 }));
    expect(published).toEqual([]);
    expect(commands().length).toBe(before);
    control.onMessage(info({ playerState: 1, currentTime: 0.2, playbackRate: 1, videoData: { isLive: false, video_id: "bbbbbbbbbbb" } }));
    expect(commands().filter((c) => c[0] === "loadVideoById")).toHaveLength(1);
  });

  it("tells once per video that it is over, and again when the same video came around", () => {
    const ended: string[] = [];
    const posted: unknown[] = [];
    const control = new YoutubeControl({ post: (data) => posted.push(data), isHidden: () => false }, { serverNow: () => Date.now(), canControl: () => false, publish: async () => {}, onCorrected: () => {}, onError: () => {}, onSoundBlocked: () => {}, onEnded: (id) => ended.push(id) });
    control.setVideo("aaaaaaaaaaa");
    control.onMessage(info({ playerState: 1, currentTime: 10, videoData: { isLive: false, video_id: "aaaaaaaaaaa" } }));
    control.onMessage(info({ playerState: 0 }));
    control.onMessage(info({ playerState: 0 }));
    expect(ended).toEqual(["aaaaaaaaaaa"]);
    control.setShared({ playing: true, position: 0, rate: 1, at: 1_000_500 }); // a queue of one: the server started it again
    control.onMessage(info({ playerState: 1, currentTime: 0 }));
    control.onMessage(info({ playerState: 0 }));
    expect(ended).toEqual(["aaaaaaaaaaa", "aaaaaaaaaaa"]);
  });

  it("takes a shared place behind the video's end for its end instead of seeking there", () => {
    const ended: string[] = [];
    const posted: string[] = [];
    const control = new YoutubeControl({ post: (data) => posted.push(data as string), isHidden: () => false }, { serverNow: () => Date.now(), canControl: () => false, publish: async () => {}, onCorrected: () => {}, onError: () => {}, onSoundBlocked: () => {}, onEnded: (id) => ended.push(id) });
    control.setVideo("aaaaaaaaaaa");
    control.setShared({ playing: true, position: 0, rate: 1, at: 1_000_000 - 500_000 }); // stands at 500 s
    control.onMessage(info({ playerState: 1, currentTime: 3, playbackRate: 1, duration: 100, videoData: { isLive: false, video_id: "aaaaaaaaaaa" } }));
    control.onMessage(info({ playerState: 1, currentTime: 4 }));
    expect(ended).toEqual(["aaaaaaaaaaa"]);
    expect(posted.some((m) => m.includes("seekTo"))).toBe(false);
  });

  it("reports a video that may not be embedded", () => {
    const { control, errors } = setup(false);
    control.onMessage(JSON.stringify({ event: "onError", info: 150 }));
    expect(errors).toEqual(["embedding"]);
  });
});
