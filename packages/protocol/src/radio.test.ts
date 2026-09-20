import { describe, expect, it } from "vitest";
import { Channel, RADIO_IDLE_STOP_MS, ServerEvent, ServerSettings, SetRadioPlaybackRequest, UpdateSettingsRequest, AdvanceRadioRequest, ChannelRadio, SetChannelRadioRequest, radioPositionAt, twitchChannelOf, youtubePlaylistOf, youtubeVideoOf } from "./index";

const U1 = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";

describe("radio sources", () => {
  it("recognizes the spellings of a YouTube video and its start offset", () => {
    expect(youtubeVideoOf("https://www.youtube.com/watch?v=aqz-KE-bpKQ")).toEqual({ videoId: "aqz-KE-bpKQ", start: 0 });
    expect(youtubeVideoOf("https://youtu.be/aqz-KE-bpKQ?t=90")).toEqual({ videoId: "aqz-KE-bpKQ", start: 90 });
    expect(youtubeVideoOf("https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=1m30s&list=PLx")).toEqual({ videoId: "aqz-KE-bpKQ", start: 90 });
    expect(youtubeVideoOf("https://music.youtube.com/watch?v=aqz-KE-bpKQ&t=1h2m3s")).toEqual({ videoId: "aqz-KE-bpKQ", start: 3723 });
    expect(youtubeVideoOf("https://www.youtube.com/live/jfKfPfyJRdk?si=abc")).toEqual({ videoId: "jfKfPfyJRdk", start: 0 });
    expect(youtubeVideoOf("https://www.youtube.com/shorts/aqz-KE-bpKQ")?.videoId).toBe("aqz-KE-bpKQ");
    expect(youtubeVideoOf("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?start=12")).toEqual({ videoId: "aqz-KE-bpKQ", start: 12 });
    expect(youtubeVideoOf("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=abc")).toEqual({ videoId: "aqz-KE-bpKQ", start: 0 });
  });

  it("takes nothing else for a YouTube video", () => {
    for (const url of ["https://www.youtube.com/", "https://www.youtube.com/watch", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/@LofiGirl", "https://www.youtube.com/playlist?list=PLx",
      "https://youtu.be/", "https://youtu.be/a/b", "https://notyoutube.com/watch?v=aqz-KE-bpKQ", "https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ", "ftp://youtu.be/aqz-KE-bpKQ", "https://www.twitch.tv/lofigirl", "nonsense"]) {
      expect(youtubeVideoOf(url), url).toBeNull();
    }
    expect(twitchChannelOf("https://www.youtube.com/watch?v=aqz-KE-bpKQ")).toBeNull();
  });

  it("recognizes a YouTube playlist, with or without the video to start at", () => {
    expect(youtubePlaylistOf("https://www.youtube.com/playlist?list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H")).toEqual({ listId: "PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H", videoId: null });
    expect(youtubePlaylistOf("https://music.youtube.com/watch?v=aqz-KE-bpKQ&list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H&index=3")).toEqual({ listId: "PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H", videoId: "aqz-KE-bpKQ" });
    expect(youtubePlaylistOf("https://youtu.be/aqz-KE-bpKQ?list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H")?.videoId).toBe("aqz-KE-bpKQ");
    for (const url of ["https://www.youtube.com/watch?v=aqz-KE-bpKQ", "https://www.youtube.com/playlist?list=PLx", "https://www.youtube.com/playlist?list=bad id with spaces", "https://www.youtube.com/@LofiGirl?list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H",
      "https://youtu.be/?list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H", "https://example.org/playlist?list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H", "nonsense"]) expect(youtubePlaylistOf(url), url).toBeNull();
  });

  it("takes the playlist's videos with the request and carries the queue on the channel's radio", () => {
    expect(SetChannelRadioRequest.safeParse({ url: "https://www.youtube.com/playlist?list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H", videoIds: ["aqz-KE-bpKQ", "jfKfPfyJRdk"] }).success).toBe(true);
    expect(SetChannelRadioRequest.safeParse({ stationId: U1, videoIds: ["aqz-KE-bpKQ"] }).success).toBe(true);
    expect(SetChannelRadioRequest.safeParse({ stationId: U1 }).success).toBe(true);
    expect(SetChannelRadioRequest.safeParse({ url: "https://example.org/a", videoIds: ["too-short"] }).success).toBe(false);
    expect(SetChannelRadioRequest.safeParse({ url: "https://example.org/a", videoIds: [] }).success).toBe(false);
    expect(SetChannelRadioRequest.safeParse({ url: "https://example.org/a", videoIds: Array.from({ length: 201 }, () => "aqz-KE-bpKQ") }).success).toBe(false);
    expect(AdvanceRadioRequest.parse({ from: "aqz-KE-bpKQ" })).toEqual({ from: "aqz-KE-bpKQ", step: 1, ended: false });
    expect(AdvanceRadioRequest.safeParse({ from: "aqz-KE-bpKQ", step: 2 }).success).toBe(false);
    // A server from before the queue sends none.
    expect(ChannelRadio.parse({ stationId: null, name: "x", streamUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", startedBy: null }).queue).toBeNull();
  });

  it("moves a playing video on from the server's stamp and leaves a paused one where it is", () => {
    expect(radioPositionAt({ playing: true, position: 10, rate: 1, at: 1_000 }, 4_500)).toBeCloseTo(13.5);
    expect(radioPositionAt({ playing: true, position: 10, rate: 1.5, at: 1_000 }, 5_000)).toBeCloseTo(16);
    expect(radioPositionAt({ playing: false, position: 10, rate: 1, at: 1_000 }, 99_000)).toBe(10);
    // A client clock slightly behind the server's must not move the video backwards.
    expect(radioPositionAt({ playing: true, position: 10, rate: 1, at: 1_000 }, 900)).toBe(10);
  });

  it("carries the playback state on the channel and as an event, and older servers' channels still parse", () => {
    const base = { id: U1, kind: "voice", name: "Lobby", topic: null, categoryId: null, position: 0, audioBitrate: 64, audioStereo: false };
    const old = Channel.parse({ ...base, radio: { stationId: null, name: "x", streamUrl: "https://a.example/s", startedBy: null } });
    expect(old.radio).toMatchObject({ twitchChannel: null, youtubeVideo: null, playback: null });
    const now = Channel.parse({ ...base, radio: { stationId: null, name: "Video", streamUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", startedBy: null, youtubeVideo: "aqz-KE-bpKQ", playback: { playing: true, position: 3, rate: 1, at: 5 } } });
    expect(now.radio?.playback).toEqual({ playing: true, position: 3, rate: 1, at: 5 });
    expect(ServerEvent.safeParse({ type: "radio.playback", channelId: U1, playback: { playing: false, position: 12.5, rate: 1, at: 1 } }).success).toBe(true);
    expect(ServerEvent.safeParse({ type: "radio.playback", channelId: U1, playback: { playing: false, position: -1, rate: 1, at: 1 } }).success).toBe(false);
  });

  it("checks what a controller may set", () => {
    expect(SetRadioPlaybackRequest.parse({ playing: true, position: 5 })).toEqual({ playing: true, position: 5, rate: 1 });
    expect(SetRadioPlaybackRequest.safeParse({ playing: true, position: 5, rate: 4 }).success).toBe(false);
    expect(SetRadioPlaybackRequest.safeParse({ playing: true, position: Infinity }).success).toBe(false);
    expect(SetRadioPlaybackRequest.safeParse({ playing: "yes", position: 5 }).success).toBe(false);
  });

  it("has the idle stop as an optional setting", () => {
    const settings = { name: "S", openJoin: true, ownerId: null, iconUrl: null, requireAccount: false, requireAccountLocked: false, listed: false, description: null };
    expect(ServerSettings.parse(settings).radioAutoStop).toBeUndefined(); // a server from before the switch
    expect(ServerSettings.parse({ ...settings, radioAutoStop: false }).radioAutoStop).toBe(false);
    expect(UpdateSettingsRequest.parse({ radioAutoStop: true })).toEqual({ radioAutoStop: true });
    expect(RADIO_IDLE_STOP_MS).toBe(120_000);
  });
});
