import { describe, expect, it } from "vitest";
import { playerFrameAllow, playerOriginOf, playerWindowUrl } from "./playerWindow";

describe("player window", () => {
  it("frames the two official players only", () => {
    expect(playerOriginOf("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ")).toBe("https://www.youtube-nocookie.com");
    expect(playerOriginOf("https://player.twitch.tv/?channel=x")).toBe("https://player.twitch.tv");
    expect(playerOriginOf("https://example.org/")).toBeNull();
    expect(playerOriginOf("http://player.twitch.tv/")).toBeNull();
  });

  it("asks for the output device policy only where the platform can route the player's sound", () => {
    expect(playerFrameAllow(false)).toBe("autoplay; fullscreen; encrypted-media; picture-in-picture");
    expect(playerFrameAllow(true)).toContain("microphone");
    expect(playerWindowUrl("https://player.twitch.tv/?channel=x", "x")).not.toContain("route=");
    expect(new URLSearchParams(playerWindowUrl("https://player.twitch.tv/?channel=x", "x", true).split("?")[1]).get("route")).toBe("1");
  });
});
