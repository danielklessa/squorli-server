import { describe, expect, it, vi } from "vitest";
import { openMic } from "./micPipeline";

const stream = {} as MediaStream;
const named = (name: string) => Object.assign(new Error(name), { name });
const deviceOf = (c: MediaStreamConstraints) => (c.audio as MediaTrackConstraints).deviceId;

describe("openMic", () => {
  it("asks for the chosen device exactly", async () => {
    const gum = vi.fn(async (_c: MediaStreamConstraints) => stream);
    expect(await openMic(gum, "usb-headset", false)).toEqual({ stream, fellBack: false });
    expect(deviceOf(gum.mock.calls[0]![0])).toEqual({ exact: "usb-headset" });
  });

  it("uses the default microphone when the chosen device is gone", async () => {
    // A stored device id that no longer exists made the whole join fail with "Constraints could not be satisfied".
    for (const name of ["OverconstrainedError", "NotFoundError"]) {
      const gum = vi.fn(async (c: MediaStreamConstraints) => { if (deviceOf(c)) throw named(name); return stream; });
      expect(await openMic(gum, "unplugged", true)).toEqual({ stream, fellBack: true });
      expect(gum).toHaveBeenCalledTimes(2);
      expect(gum.mock.calls[1]![0].audio).toMatchObject({ channelCount: 2, echoCancellation: false });
    }
  });

  it("accepts Chromium's OverconstrainedError, which is no Error instance", async () => {
    const gum = vi.fn(async (c: MediaStreamConstraints) => { if (deviceOf(c)) throw { name: "OverconstrainedError", constraint: "deviceId" }; return stream; });
    expect((await openMic(gum, "unplugged", false)).fellBack).toBe(true);
  });

  it("does not retry other errors or a request without a device", async () => {
    const denied = vi.fn(async (_c: MediaStreamConstraints): Promise<MediaStream> => { throw named("NotAllowedError"); });
    await expect(openMic(denied, "usb-headset", false)).rejects.toThrow("NotAllowedError");
    expect(denied).toHaveBeenCalledTimes(1);
    const none = vi.fn(async (_c: MediaStreamConstraints): Promise<MediaStream> => { throw named("NotFoundError"); });
    await expect(openMic(none, null, false)).rejects.toThrow("NotFoundError");
    expect(none).toHaveBeenCalledTimes(1);
  });
});
