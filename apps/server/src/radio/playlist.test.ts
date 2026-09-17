import { describe, expect, it } from "vitest";
import { firstPlaylistEntry, isHlsPlaylist, isPlaylistUrl } from "./playlist";
import { isInternalAddress, resolveStreamUrl } from "./resolve";

describe("radio playlists", () => {
  it("tells a playlist from a stream by the path's extension", () => {
    expect(isPlaylistUrl("https://example.org/radio.m3u")).toBe(true);
    expect(isPlaylistUrl("https://example.org/radio.M3U8?x=1")).toBe(true);
    expect(isPlaylistUrl("http://example.org/listen.pls")).toBe(true);
    expect(isPlaylistUrl("https://streams.radiobob.de/bob-national/mp3-128/streams.radiobob.de/")).toBe(false);
    expect(isPlaylistUrl("https://example.org/stream.mp3?list=a.m3u")).toBe(false);
    expect(isPlaylistUrl("kein link")).toBe(false);
  });

  it("takes the first address of an m3u, skipping comments and other schemes", () => {
    const m3u = "﻿#EXTM3U\r\n#EXTINF:-1,Radio Beispiel\r\n\r\nftp://example.org/x\r\nhttps://stream.example.org/live.mp3\r\nhttps://stream.example.org/second.mp3\r\n";
    expect(firstPlaylistEntry(m3u, "https://example.org/radio.m3u")).toBe("https://stream.example.org/live.mp3");
  });

  it("resolves relative entries against the playlist", () => {
    expect(firstPlaylistEntry("live/stream.aac\n", "https://example.org/radio/list.m3u")).toBe("https://example.org/radio/live/stream.aac");
  });

  it("reads pls files", () => {
    const pls = "[playlist]\nNumberOfEntries=2\nTitle1=Radio\nFile1=http://stream.example.org:8000/live\nLength1=-1\nFile2=http://stream.example.org:8000/backup\nVersion=2\n";
    expect(firstPlaylistEntry(pls, "https://example.org/listen.pls")).toBe("http://stream.example.org:8000/live");
  });

  it("finds nothing in an empty or foreign file", () => {
    expect(firstPlaylistEntry("#EXTM3U\n# nothing\n", "https://example.org/a.m3u")).toBeNull();
    expect(firstPlaylistEntry("", "https://example.org/a.m3u")).toBeNull();
  });

  it("recognizes HLS, whose entries are segments and not a stream", () => {
    expect(isHlsPlaylist("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.aac\n")).toBe(true);
    expect(isHlsPlaylist("#EXTM3U\n#EXTINF:-1,Radio\nhttps://stream.example.org/live.mp3\n")).toBe(false);
  });
});

describe("radio resolving", () => {
  it("never asks the network for a plain stream address", async () => {
    const url = "https://streams.radiobob.de/bob-national/mp3-128/streams.radiobob.de/";
    expect(await resolveStreamUrl(url)).toEqual({ ok: true, streamUrl: url });
  });

  it("refuses playlists on the host itself or in private networks", async () => {
    for (const url of ["http://127.0.0.1:3000/a.m3u", "http://localhost/a.m3u", "http://192.168.1.10/a.pls", "http://[::1]/a.m3u", "http://169.254.169.254/latest/a.m3u"])
      expect(await resolveStreamUrl(url), url).toEqual({ ok: false, error: "forbidden_host" });
  });

  it("reports a host that does not exist as unreachable, not as forbidden", async () => {
    expect(await resolveStreamUrl("https://sender.invalid/radio.m3u")).toEqual({ ok: false, error: "unreachable" });
  });

  it("knows internal addresses", () => {
    for (const a of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "::ffff:7f00:1", "kein"]) expect(isInternalAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2a00:1450:4001:81b::200e", "::ffff:8.8.8.8"]) expect(isInternalAddress(a), a).toBe(false);
  });
});
