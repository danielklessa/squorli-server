import { ScreenSharePresets, type TrackPublishOptions } from "livekit-client";

/** What the platform says about a share after its capture (`PlatformMedia.screenSharePublishOverrides`): the codec picked in the desktop app's dialog. */
export type ScreenShareOverrides = { videoCodec?: "vp8" | "h264" | "h265" } | null | undefined;

/** Upper limits of a share of moving pictures. H.265 needs less for the same picture; every viewer receives what is sent. */
export const MOVING_SHARE_BITRATE = { h264: 8_000_000, h265: 6_000_000 } as const;

/**
 * Publish options and content hint of a screen share; pure, tested.
 * - Standing share (VP8): no simulcast (with small tiles adaptiveStream would fetch the coarse layer, text needs the full one),
 *   hint "detail" and LiveKit's "maintain-resolution": text stays sharp, frames go when bandwidth is tight.
 * - H.264 or H.265 is the user's choice for moving pictures (a game, "Quick Share"): hint "motion", "maintain-framerate" and a
 *   higher limit. Measured on 21 September 2026 (Electron 44, 1080p30): with "detail" Chromium runs OpenH264 in its mode for
 *   screen content, 13-14 frames per second at 16-17 ms each; with "motion" 28-30 at under 2 ms.
 * - H.265 is encoded by the graphics unit (Chromium offers it only then). Both get VP8 as LiveKit's backup codec (H.264 had it
 *   before, as LiveKit's default): once a viewer cannot decode the codec (H.265: Firefox) the whole share falls back to VP8
 *   (LiveKit's default policy, one encoder at a time).
 * The limit goes to LiveKit as `screenShareEncoding`: for a track of the source screen share it reads nothing else
 * (`videoEncoding` is ignored there, also for the backup codec, which therefore runs with the same limit).
 */
export function screenSharePublish(overrides: ScreenShareOverrides): { options: TrackPublishOptions; contentHint: "detail" | "motion" } {
  const codec = overrides?.videoCodec;
  const still = ScreenSharePresets.h1080fps30.encoding;
  if (codec !== "h264" && codec !== "h265") return { options: { simulcast: false, screenShareEncoding: still }, contentHint: "detail" };
  return {
    options: {
      simulcast: false, videoCodec: codec, degradationPreference: "maintain-framerate",
      screenShareEncoding: { maxBitrate: MOVING_SHARE_BITRATE[codec], maxFramerate: 30 },
      backupCodec: { codec: "vp8" },
    },
    contentHint: "motion",
  };
}
