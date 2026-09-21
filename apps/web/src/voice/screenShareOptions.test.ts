import { describe, expect, it } from "vitest";
import { screenSharePublish } from "./screenShareOptions";

describe("screen share publish options", () => {
  it("keeps the standing share on detail: no simulcast, 5 Mbit/s, the room's codec", () => {
    for (const overrides of [null, undefined, {}, { videoCodec: "vp8" as const }]) {
      const { options, contentHint } = screenSharePublish(overrides);
      expect(contentHint).toBe("detail");
      expect(options).toEqual({ simulcast: false, screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 30, priority: "medium" } });
    }
  });

  it("sends H.264 as moving pictures: motion, frames before resolution, a higher limit, VP8 as the backup", () => {
    const { options, contentHint } = screenSharePublish({ videoCodec: "h264" });
    expect(contentHint).toBe("motion");
    expect(options).toMatchObject({ simulcast: false, videoCodec: "h264", degradationPreference: "maintain-framerate", screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 30 }, backupCodec: { codec: "vp8" } });
    // LiveKit ignores `videoEncoding` for a screen share: the limit would silently stay at the room's default.
    expect(options).not.toHaveProperty("videoEncoding");
  });

  it("sends H.265 the same way with VP8 as the backup for viewers that cannot decode it", () => {
    const { options, contentHint } = screenSharePublish({ videoCodec: "h265" });
    expect(contentHint).toBe("motion");
    expect(options).toMatchObject({ simulcast: false, videoCodec: "h265", degradationPreference: "maintain-framerate", screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 }, backupCodec: { codec: "vp8" } });
  });
});
