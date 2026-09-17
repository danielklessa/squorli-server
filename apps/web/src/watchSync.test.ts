import { describe, expect, it } from "vitest";
import { decideSync, type PlayerReport } from "./watchSync";
import { YT, readYoutubeMessage, youtubeAudioCommands, youtubeCommand, youtubeErrorKind, youtubeListening, youtubePlayerSrc } from "./youtube";

const playingAt100 = { playing: true, position: 100, rate: 1, at: 1_000_000 };
const pausedAt100 = { playing: false, position: 100, rate: 1, at: 1_000_000 };
const report = (state: number, time: number, more: Partial<PlayerReport> = {}): PlayerReport => ({ state, time, rate: 1, live: false, ...more });
const base = { serverNow: 1_010_000, stable: null, canControl: false, force: false, allowLagSeek: true, playedSinceCommand: true }; // 10 s later: the video stands at 110

describe("watching in step", () => {
  it("leaves a player alone that is where it should be", () => {
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.PLAYING, 110.4), stable: report(YT.PLAYING, 110.1) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.BUFFERING, 109) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, serverNow: 9_999_999, shared: pausedAt100, report: report(YT.PAUSED, 100.2) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, shared: pausedAt100, report: report(YT.CUED, 100) })).toEqual({ kind: "none" });
  });

  it("publishes what a controller does in their player", () => {
    const c = { ...base, canControl: true };
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.PAUSED, 110.2) })).toEqual({ kind: "publish", playback: { playing: false, position: 110.2, rate: 1 } });
    expect(decideSync({ ...c, shared: pausedAt100, report: report(YT.PLAYING, 100.1) })).toEqual({ kind: "publish", playback: { playing: true, position: 100.1, rate: 1 } });
    // moved forward: ahead of the shared place
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.PLAYING, 300), stable: report(YT.PLAYING, 110) })).toEqual({ kind: "publish", playback: { playing: true, position: 300, rate: 1 } });
    // moved back: the time went backwards
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.PLAYING, 40), stable: report(YT.PLAYING, 110) })).toEqual({ kind: "publish", playback: { playing: true, position: 40, rate: 1 } });
    // moved while paused
    expect(decideSync({ ...c, shared: pausedAt100, report: report(YT.PAUSED, 250), stable: report(YT.PAUSED, 100) })).toEqual({ kind: "publish", playback: { playing: false, position: 250, rate: 1 } });
    // pressed play after moving while paused: the player buffers first, and must not be paused again before it plays
    expect(decideSync({ ...c, shared: pausedAt100, report: report(YT.BUFFERING, 100) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, shared: pausedAt100, report: report(YT.BUFFERING, 100) })).toMatchObject({ kind: "apply", play: false });
    // another speed
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.PLAYING, 110, { rate: 1.5 }) })).toEqual({ kind: "publish", playback: { playing: true, position: 110, rate: 1.5 } });
  });

  it("does not take a controller's buffering, late start or ended video for an action", () => {
    const c = { ...base, canControl: true };
    // behind after buffering: caught up, nothing published
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.PLAYING, 103), stable: report(YT.PLAYING, 102.8) })).toEqual({ kind: "apply", seekTo: 110, play: null, rate: null, corrected: false, lag: true });
    // still buffering after their own move forward: neither published yet nor moved back
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.BUFFERING, 300), stable: report(YT.PLAYING, 110) })).toEqual({ kind: "none" });
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.ENDED, 600) })).toEqual({ kind: "none" });
    // told to play but never seen playing (the browser refused): asked again, the pause is not published for everyone
    expect(decideSync({ ...c, playedSinceCommand: false, shared: playingAt100, report: report(YT.PAUSED, 110) })).toEqual({ kind: "apply", seekTo: null, play: true, rate: null, corrected: false, lag: false });
    // the player has not started (autoplay refused): asked to play, nothing published
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.UNSTARTED, 110) })).toEqual({ kind: "apply", seekTo: null, play: true, rate: null, corrected: false, lag: false });
  });

  it("never publishes what the player shows right after the shared state changed", () => {
    const c = { ...base, canControl: true, force: true };
    expect(decideSync({ ...c, shared: pausedAt100, report: report(YT.PLAYING, 180), stable: report(YT.PLAYING, 179) })).toEqual({ kind: "apply", seekTo: 100, play: false, rate: null, corrected: false, lag: false });
    expect(decideSync({ ...c, shared: playingAt100, report: report(YT.ENDED, 600) })).toEqual({ kind: "apply", seekTo: 110, play: true, rate: null, corrected: false, lag: false });
  });

  it("brings everybody else back and says so when they paused or moved the video themselves", () => {
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.PAUSED, 110) })).toEqual({ kind: "apply", seekTo: null, play: true, rate: null, corrected: true, lag: false });
    expect(decideSync({ ...base, shared: pausedAt100, report: report(YT.PLAYING, 100) })).toEqual({ kind: "apply", seekTo: null, play: false, rate: null, corrected: true, lag: false });
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.PLAYING, 300), stable: report(YT.PLAYING, 110) })).toEqual({ kind: "apply", seekTo: 110, play: null, rate: null, corrected: true, lag: false });
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.PLAYING, 110, { rate: 2 }) })).toEqual({ kind: "apply", seekTo: null, play: null, rate: 1, corrected: false, lag: false });
  });

  it("catches up after buffering, but not again and again, and not while still buffering", () => {
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.PLAYING, 104) })).toEqual({ kind: "apply", seekTo: 110, play: null, rate: null, corrected: false, lag: true });
    expect(decideSync({ ...base, allowLagSeek: false, shared: playingAt100, report: report(YT.PLAYING, 104) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.BUFFERING, 104) })).toEqual({ kind: "none" });
  });

  it("leaves a live stream to each viewer: nothing is published, nothing corrected", () => {
    const live = { live: true };
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.PLAYING, 15_903_084, live), stable: report(YT.PLAYING, 15_903_080, live) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, shared: playingAt100, report: report(YT.PAUSED, 15_903_084, live) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, canControl: true, shared: playingAt100, report: report(YT.PAUSED, 15_903_084, live) })).toEqual({ kind: "none" });
    expect(decideSync({ ...base, canControl: true, force: true, shared: pausedAt100, report: report(YT.PLAYING, 15_903_084, live) })).toEqual({ kind: "none" });
  });
});

describe("youtube player protocol", () => {
  it("builds the privacy-enhanced embed address, muted, at the shared place", () => {
    const src = new URL(youtubePlayerSrc("aqz-KE-bpKQ", "https://chat.example.org", 93.7, true));
    expect(src.origin + src.pathname).toBe("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ");
    expect(Object.fromEntries(src.searchParams)).toEqual({ enablejsapi: "1", origin: "https://chat.example.org", autoplay: "1", mute: "1", playsinline: "1", rel: "0", start: "93" });
    const paused = new URL(youtubePlayerSrc("aqz-KE-bpKQ", "http://localhost:5173", 0, false));
    expect(paused.searchParams.get("autoplay")).toBe("0");
    expect(paused.searchParams.has("start")).toBe(false);
  });

  it("speaks the widget's message format", () => {
    expect(JSON.parse(youtubeListening())).toEqual({ event: "listening", id: 1, channel: "widget" });
    expect(JSON.parse(youtubeCommand("seekTo", 12.5, true))).toEqual({ event: "command", func: "seekTo", args: [12.5, true], id: 1, channel: "widget" });
    expect(youtubeAudioCommands(0.05, false).map((c) => JSON.parse(c))).toMatchObject([{ func: "setVolume", args: [5] }, { func: "unMute", args: [] }]);
    expect(youtubeAudioCommands(0.5, true).map((c) => JSON.parse(c).func)).toEqual(["setVolume", "mute"]);
    expect(youtubeAudioCommands(0, false).map((c) => JSON.parse(c).func)).toEqual(["setVolume", "mute"]);
  });

  it("reads the player's reports, which are partial, and ignores everything else", () => {
    expect(readYoutubeMessage(JSON.stringify({ event: "infoDelivery", info: { currentTime: 12.3, playerState: 1, playbackRate: 1.5, videoData: { isLive: false, title: "x" } } }))).toEqual({ state: 1, time: 12.3, rate: 1.5, live: false });
    expect(readYoutubeMessage(JSON.stringify({ event: "infoDelivery", info: { currentTime: 13 } }))).toEqual({ time: 13 });
    expect(readYoutubeMessage({ event: "initialDelivery", info: { playerState: -1, videoData: { isLive: true } } })).toEqual({ state: -1, live: true });
    expect(readYoutubeMessage(JSON.stringify({ event: "onError", info: 150 }))).toEqual({ error: 150 });
    expect(readYoutubeMessage(JSON.stringify({ event: "onReady" }))).toEqual({});
    expect(readYoutubeMessage(JSON.stringify({ event: "infoDelivery", info: null }))).toEqual({});
    for (const other of ["not json", "{\"event\":\"apiInfoDelivery\"}", 5, null, { event: "other" }]) expect(readYoutubeMessage(other)).toBeNull();
    expect([101, 150, 100, 2, 5].map(youtubeErrorKind)).toEqual(["embedding", "embedding", "missing", "missing", "other"]);
  });
});
