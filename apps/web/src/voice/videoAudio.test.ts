import { afterEach, describe, expect, it, vi } from "vitest";
import { Track } from "livekit-client";
import { VoiceClient } from "./voiceClient";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  // Model DOM adoption: appendChild moves the same element to a new parent.
  const makeHost = () => {
    const node = { appendChild: (element: { parentElement: unknown }) => { element.parentElement = node; } };
    return node as unknown as HTMLElement;
  };
  const main = makeHost(), camera = makeHost(), screen = makeHost();
  const client = new VoiceClient(main);
  const audio = (source: Track.Source) => {
    const element = { parentElement: main, muted: false, volume: 0.4, sinkId: "headset", play: vi.fn().mockResolvedValue(undefined) };
    const registry = Reflect.get(client, "remoteAudio") as Map<unknown, unknown>;
    registry.set({ source, getVolume: () => element.volume, setVolume: (volume: number) => { element.volume = volume; } }, { element, identity: "alice" });
    return element;
  };
  return { client, main, camera, screen, audio };
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
    expect(share.volume).toBe(0.4);
    client.toggleVideoAudioMuted("unknown:screen");
    expect(share.volume).toBe(0.4);
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
