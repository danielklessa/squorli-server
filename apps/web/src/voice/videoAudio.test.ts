import { afterEach, describe, expect, it, vi } from "vitest";
import { Track } from "livekit-client";
import { VoiceClient } from "./voiceClient";

afterEach(() => vi.unstubAllGlobals());

type FakeGain = { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

/** Chromium's AudioContext as far as the share route uses it: a sink of its own, a source and a gain. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState = "running";
  static refuseSink = false;
  state = FakeAudioContext.initialState;
  onstatechange: (() => void) | null = null;
  destination = { kind: "destination" };
  sinks: string[] = [];
  sources: { stream: unknown; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  gains: FakeGain[] = [];
  constructor() { FakeAudioContext.instances.push(this); }
  setSinkId(id: string): Promise<void> { this.sinks.push(id); return FakeAudioContext.refuseSink ? Promise.reject(new Error("not allowed")) : Promise.resolve(); }
  createMediaStreamSource(stream: unknown) { const source = { stream, connect: vi.fn(), disconnect: vi.fn() }; this.sources.push(source); return source; }
  createGain(): FakeGain { const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; this.gains.push(gain); return gain; }
  resume(): Promise<void> { this.state = "running"; this.onstatechange?.(); return Promise.resolve(); }
}
class FakeMediaStream { constructor(readonly tracks: unknown[]) {} }

type FakeElement = { parentElement: unknown; muted: boolean; volume: number; sinkId: string; play: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
type FakeTrack = { source: Track.Source; mediaStreamTrack: object; getVolume: () => number; setVolume: (volume: number) => void; setSinkId: ReturnType<typeof vi.fn> };

function setup(opts: { webAudio?: boolean } = {}) {
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  FakeAudioContext.instances = []; FakeAudioContext.initialState = "running"; FakeAudioContext.refuseSink = false;
  if (opts.webAudio) { vi.stubGlobal("AudioContext", FakeAudioContext); vi.stubGlobal("MediaStream", FakeMediaStream); }
  else { vi.stubGlobal("AudioContext", undefined); }
  // Model DOM adoption: appendChild moves the same element to a new parent.
  const makeHost = () => {
    const node = { appendChild: (element: { parentElement: unknown }) => { element.parentElement = node; }, replaceChildren: () => {} };
    return node as unknown as HTMLElement;
  };
  const main = makeHost(), camera = makeHost(), screen = makeHost();
  const client = new VoiceClient(main);
  const tracks = new Map<FakeElement, FakeTrack>();
  const audio = (source: Track.Source): FakeElement => {
    const element: FakeElement = { parentElement: main, muted: false, volume: 0.4, sinkId: "headset", play: vi.fn().mockResolvedValue(undefined), remove: vi.fn() };
    const track: FakeTrack = { source, mediaStreamTrack: {}, getVolume: () => element.volume, setVolume: (volume: number) => { element.volume = volume; }, setSinkId: vi.fn() };
    const registry = Reflect.get(client, "remoteAudio") as Map<unknown, unknown>;
    registry.set(track, { element, identity: "alice" });
    tracks.set(element, track);
    return element;
  };
  const trackOf = (element: FakeElement) => tracks.get(element)!;
  const ctx = () => FakeAudioContext.instances[0]!;
  return { client, main, camera, screen, audio, trackOf, ctx };
}

describe("pop-out audio routing", () => {
  it("mutes only screen playback and restores its volume across a pop-out", async () => {
    const { client, screen, audio } = setup();
    const mic = audio(Track.Source.Microphone), share = audio(Track.Source.ScreenShareAudio);
    client.setVideoAudioVolume("alice:screen", 0.65);
    client.toggleVideoAudioMuted("alice:screen");
    expect(share.volume).toBe(0);
    expect(mic.volume).toBe(0.4);
    // A pop-out listens to its share (VideoWindows.tsx); only then its audio plays at all.
    const restore = client.setVideoAudioHost("alice:screen", screen);
    client.setScreenAudioListening("alice:screen", "popout", true);
    await client.setDeafened(true);
    client.toggleVideoAudioMuted("alice:screen");
    expect(share.volume).toBe(0.65);
    expect(share.muted).toBe(true);
    restore();
    await client.setDeafened(false);
    expect(share.volume).toBe(0.65);
    expect(share.muted).toBe(false);
  });
  it("plays a share's audio only while the user listens to that share", async () => {
    const { client, audio } = setup();
    const mic = audio(Track.Source.Microphone), share = audio(Track.Source.ScreenShareAudio);
    await client.setDeafened(false); // applies the rule to the elements
    expect(mic.muted).toBe(false);
    expect(share.muted).toBe(true);
    expect(client.isScreenAudioListening("alice:screen")).toBe(false);
    client.setScreenAudioListening("alice:screen", "stage", true);
    client.setScreenAudioListening("alice:screen", "popout", true);
    expect(share.muted).toBe(false);
    client.setScreenAudioListening("alice:screen", "stage", false);
    expect(share.muted).toBe(false); // the pop-out still listens
    await client.setDeafened(true);
    expect(share.muted).toBe(true);
    await client.setDeafened(false);
    client.setScreenAudioListening("alice:screen", "popout", false);
    expect(share.muted).toBe(true);
    expect(mic.muted).toBe(false);
  });
  it("restores the previous volume after moving the slider to zero", () => {
    const { client, audio } = setup();
    const share = audio(Track.Source.ScreenShareAudio);
    client.setScreenAudioVolume("alice", 0);
    client.toggleVideoAudioMuted("alice:screen");
    expect(share.volume).toBe(1);
    client.toggleVideoAudioMuted("unknown:screen");
    expect(share.volume).toBe(1);
  });
  it("adjusts only the selected feed and retains its volume after restoring", () => {
    const { client, camera, audio } = setup();
    const mic = audio(Track.Source.Microphone), share = audio(Track.Source.ScreenShareAudio);
    const restore = client.setVideoAudioHost("alice:camera", camera);
    client.setVideoAudioVolume("alice:camera", 0.75);
    expect(client.getVideoAudioVolume("alice:camera")).toBe(0.75);
    expect(share.volume).toBe(0.4);
    restore();
    expect(mic.volume).toBe(0.75);
    // A camera's audio is the person's microphone = the per-person volume up to 200 %. Above 100 % needs the running
    // Web Audio path; without it (as here) the element plays at 100 % while the chosen value is kept.
    client.setVideoAudioVolume("alice:camera", 2);
    expect(mic.volume).toBe(1);
    expect(client.getVideoAudioVolume("alice:camera")).toBe(2);
    expect(client.getUserVolume("id:alice")).toBe(2);
    client.setUserVolume("id:alice", 0.5);
    expect(mic.volume).toBe(0.5);
    expect(share.volume).toBe(0.4);
    expect(client.getVideoAudioVolume("unknown:camera")).toBeNull();
  });
  it("moves camera voice and screen audio independently and restores the same elements", () => {
    const { client, main, camera, screen, audio } = setup();
    const mic = audio(Track.Source.Microphone), share = audio(Track.Source.ScreenShareAudio);
    const restoreCamera = client.setVideoAudioHost("alice:camera", camera);
    expect(mic.parentElement).toBe(camera);
    expect(share.parentElement).toBe(main);
    const restoreScreen = client.setVideoAudioHost("alice:screen", screen);
    expect(share.parentElement).toBe(screen);
    restoreCamera(); restoreScreen();
    expect(mic.parentElement).toBe(main);
    expect(share.parentElement).toBe(main);
    expect(mic.volume).toBe(0.4);
    expect(mic.sinkId).toBe("headset");
  });
  it("applies deafen to audio in a popup and preserves it on return", async () => {
    const { client, main, camera, audio } = setup();
    const mic = audio(Track.Source.Microphone);
    const restore = client.setVideoAudioHost("alice:camera", camera);
    await client.setDeafened(true);
    expect(mic.muted).toBe(true);
    restore();
    expect(mic.parentElement).toBe(main);
    expect(mic.muted).toBe(true);
    await client.setDeafened(false);
    expect(mic.muted).toBe(false);
  });
  it("keeps unselected shares and deafen silent when LiveKit's startAudio unmutes every element", async () => {
    const { client, audio } = setup();
    const mic = audio(Track.Source.Microphone), share = audio(Track.Source.ScreenShareAudio);
    // LiveKit's room.startAudio() sets muted = false on all attached elements before its first await.
    const room = { canPlaybackAudio: true, startAudio: () => { for (const el of [mic, share]) el.muted = false; return Promise.resolve(); } };
    const withRoom = async () => { Reflect.set(client, "room", room); await client.startAudio(); Reflect.set(client, "room", null); };
    await client.setDeafened(false);
    await withRoom();
    expect(mic.muted).toBe(false);
    expect(share.muted).toBe(true);
    await client.setDeafened(true);
    await withRoom();
    expect(mic.muted).toBe(true);
    expect(share.muted).toBe(true);
  });
  it("does not let stale cleanup steal audio from a replacement popup", () => {
    const { client, camera, screen, audio } = setup();
    const mic = audio(Track.Source.Microphone);
    const staleCleanup = client.setVideoAudioHost("alice:camera", camera);
    client.setVideoAudioHost("alice:camera", screen);
    staleCleanup();
    expect(mic.parentElement).toBe(screen);
  });
});

// Chromium plays every remote WebRTC track of a page through ONE shared output sink, so a share on its own device runs
// through its own AudioContext while LiveKit's element keeps playing at volume 0 (applyShareAudio in voiceClient.ts).
describe("screen audio on a separate device", () => {
  it("routes the share through its own context and never touches the voices' sink", async () => {
    const { client, audio, trackOf, ctx } = setup({ webAudio: true });
    const mic = audio(Track.Source.Microphone), share = audio(Track.Source.ScreenShareAudio);
    client.setScreenAudioListening("alice:screen", "stage", true);
    await client.setScreenOutputDevice("speakers");
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(ctx().sinks).toEqual(["speakers"]);
    expect(ctx().sources[0]?.stream).toBeInstanceOf(FakeMediaStream);
    expect(ctx().gains[0]?.gain.value).toBe(1);
    expect(share.volume).toBe(0); // the element only keeps the track flowing into Web Audio
    expect(mic.volume).toBe(0.4);
    expect(mic.sinkId).toBe("headset");
    expect(trackOf(share).setSinkId).not.toHaveBeenCalled();
    expect(trackOf(mic).setSinkId).not.toHaveBeenCalled();
    expect(client.state.screenSink).toEqual({ deviceId: "speakers", tracks: 1, error: null, via: "webaudio" });
    // Deafen, "not listening" and the slider act on the gain.
    await client.setDeafened(true);
    expect(ctx().gains[0]?.gain.value).toBe(0);
    await client.setDeafened(false);
    expect(ctx().gains[0]?.gain.value).toBe(1);
    client.setScreenAudioListening("alice:screen", "stage", false);
    expect(ctx().gains[0]?.gain.value).toBe(0);
    client.setScreenAudioListening("alice:screen", "stage", true);
    client.setVideoAudioVolume("alice:screen", 0.3);
    expect(ctx().gains[0]?.gain.value).toBe(0.3);
    expect(client.getVideoAudioVolume("alice:screen")).toBe(0.3);
    expect(share.volume).toBe(0);
    client.toggleVideoAudioMuted("alice:screen");
    expect(ctx().gains[0]?.gain.value).toBe(0);
    client.toggleVideoAudioMuted("alice:screen");
    expect(ctx().gains[0]?.gain.value).toBe(0.3);
    expect(ctx().gains).toHaveLength(1); // one route per share, re-used
  });
  it("plays through the element without a separate device, and makes no context", async () => {
    const { client, audio } = setup({ webAudio: true });
    const share = audio(Track.Source.ScreenShareAudio);
    client.setScreenAudioListening("alice:screen", "stage", true);
    await client.setScreenOutputDevice(null);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(share.volume).toBe(1);
    expect(share.muted).toBe(false);
    expect(client.state.screenSink).toEqual({ deviceId: null, tracks: 1, error: null, via: "element" });
    client.setVideoAudioVolume("alice:screen", 0.3);
    expect(share.volume).toBe(0.3);
  });
  it("moves the share between the paths when the setting changes and keeps its volume", async () => {
    const { client, audio, ctx } = setup({ webAudio: true });
    const share = audio(Track.Source.ScreenShareAudio);
    client.setScreenAudioListening("alice:screen", "stage", true);
    client.setVideoAudioVolume("alice:screen", 0.3);
    await client.setScreenOutputDevice("speakers");
    expect(ctx().gains[0]?.gain.value).toBe(0.3);
    expect(share.volume).toBe(0);
    await client.setScreenOutputDevice(null);
    expect(share.volume).toBe(0.3);
    expect(ctx().gains[0]?.disconnect).toHaveBeenCalled();
    expect(ctx().sources[0]?.disconnect).toHaveBeenCalled();
    expect(client.state.screenSink.via).toBe("element");
    await client.setScreenOutputDevice("speakers");
    expect(FakeAudioContext.instances).toHaveLength(1); // the context is kept
    expect(ctx().gains[1]?.gain.value).toBe(0.3);
    expect(share.volume).toBe(0);
  });
  it("leaves the share on its element while the context is suspended, and moves it once the context runs", async () => {
    const { client, audio, ctx } = setup({ webAudio: true });
    FakeAudioContext.initialState = "suspended";
    const share = audio(Track.Source.ScreenShareAudio);
    client.setScreenAudioListening("alice:screen", "stage", true);
    await client.setScreenOutputDevice("speakers");
    expect(share.volume).toBe(1);
    expect(client.state.screenSink.via).toBe("element");
    await ctx().resume();
    expect(share.volume).toBe(0);
    expect(ctx().gains[0]?.gain.value).toBe(1);
    expect(client.state.screenSink.via).toBe("webaudio");
  });
  it("keeps the share on its element and reports it when the browser refuses the device", async () => {
    const { client, audio } = setup({ webAudio: true });
    FakeAudioContext.refuseSink = true;
    const share = audio(Track.Source.ScreenShareAudio);
    client.setScreenAudioListening("alice:screen", "stage", true);
    await client.setScreenOutputDevice("speakers");
    expect(share.volume).toBe(1);
    expect(client.state.screenSink).toEqual({ deviceId: "speakers", tracks: 1, error: "not allowed", via: "element" });
  });
  it("stays on the element where a context cannot choose its device (Firefox, Safari)", async () => {
    const { client, audio } = setup();
    const share = audio(Track.Source.ScreenShareAudio);
    client.setScreenAudioListening("alice:screen", "stage", true);
    await client.setScreenOutputDevice("speakers");
    expect(share.volume).toBe(1);
    expect(client.state.screenSink.via).toBe("element");
  });
  it("drops the routes when leaving", async () => {
    const { client, audio, ctx } = setup({ webAudio: true });
    audio(Track.Source.ScreenShareAudio);
    await client.setScreenOutputDevice("speakers");
    expect(ctx().gains).toHaveLength(1);
    await client.leave();
    expect(ctx().gains[0]?.disconnect).toHaveBeenCalled();
    expect((Reflect.get(client, "shareRoutes") as Map<unknown, unknown>).size).toBe(0);
    expect(client.state.screenSink.tracks).toBe(0);
  });
});
