import { describe, expect, it } from "vitest";
import { readYoutubeMessage, readYoutubePlaylist, youtubePlaylistProbeSrc } from "./youtube";

const delivery = (event: string, info: unknown) => JSON.stringify({ event, info, id: 1, channel: "widget" });

describe("youtube playlist probe", () => {
  it("embeds the playlist, around the video the address names", () => {
    expect(youtubePlaylistProbeSrc("PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H", null, "https://chat.example.org")).toBe("https://www.youtube-nocookie.com/embed/videoseries?listType=playlist&list=PLOU2XLYxmsIJGErt5rrCqaSGTMyyqNt2H&enablejsapi=1&origin=https%3A%2F%2Fchat.example.org&autoplay=0&mute=1");
    expect(youtubePlaylistProbeSrc("PLx", "aqz-KE-bpKQ", "https://a.example")).toContain("/embed/aqz-KE-bpKQ?listType=playlist&list=PLx");
  });

  it("takes the video ids from the player's report: well-formed ones, each once", () => {
    expect(readYoutubePlaylist(delivery("initialDelivery", { playlist: ["aqz-KE-bpKQ", "jfKfPfyJRdk", "aqz-KE-bpKQ", "bad", 7], playlistIndex: 0 }))).toEqual(["aqz-KE-bpKQ", "jfKfPfyJRdk"]);
    expect(readYoutubePlaylist(delivery("infoDelivery", { playlist: ["aqz-KE-bpKQ"] }))).toEqual(["aqz-KE-bpKQ"]);
    expect(readYoutubePlaylist(delivery("initialDelivery", { playlist: Array.from({ length: 300 }, (_, i) => `v${String(i).padStart(10, "0")}`) }))).toHaveLength(200);
  });

  it("tells a player without a playlist from one that has not said anything yet", () => {
    expect(readYoutubePlaylist(delivery("initialDelivery", { playlist: null, playlistIndex: -1 }))).toBe("none");
    expect(readYoutubePlaylist(delivery("initialDelivery", { playlist: [] }))).toBe("none");
    expect(readYoutubePlaylist(JSON.stringify({ event: "onError", info: 2 }))).toBe("none");
    expect(readYoutubePlaylist(delivery("infoDelivery", { currentTime: 1 }))).toBeNull();
    expect(readYoutubePlaylist(delivery("infoDelivery", { playlist: null }))).toBeNull();
    expect(readYoutubePlaylist(JSON.stringify({ event: "onReady" }))).toBeNull();
    expect(readYoutubePlaylist("nonsense")).toBeNull();
  });

  it("reads which video the player has", () => {
    expect(readYoutubeMessage(delivery("infoDelivery", { videoData: { video_id: "aqz-KE-bpKQ", isLive: false } }))).toEqual({ live: false, videoId: "aqz-KE-bpKQ" });
  });
});
