import { describe, expect, it, vi } from "vitest";
import { isCameraBusy, retryCameraBusy } from "./cameraRetry";

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("opening a camera that Firefox has not released yet", () => {
  it("retries once after a pause when the device could not be started", async () => {
    // Firefox: "AbortError: Starting videoinput failed" right after the previous track was stopped.
    const open = vi.fn<() => Promise<string>>().mockRejectedValueOnce(named("AbortError", "Starting videoinput failed")).mockResolvedValueOnce("track");
    const wait = vi.fn(async (_ms: number) => {});
    expect(await retryCameraBusy(open, 600, wait)).toBe("track");
    expect(open).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(600);
  });
  it("gives up after the second failure (the camera is held by another program)", async () => {
    const open = vi.fn<() => Promise<string>>().mockRejectedValue(named("NotReadableError", "Failed to allocate videosource"));
    await expect(retryCameraBusy(open, 0, async () => {})).rejects.toThrow("Failed to allocate videosource");
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("does not retry a refusal or a missing device", async () => {
    for (const name of ["NotAllowedError", "NotFoundError", "OverconstrainedError"]) {
      const open = vi.fn<() => Promise<string>>().mockRejectedValue(named(name, name));
      await expect(retryCameraBusy(open, 0, async () => {})).rejects.toThrow(name);
      expect(open).toHaveBeenCalledTimes(1);
    }
    expect(isCameraBusy({ name: "AbortError" })).toBe(true);
    expect(isCameraBusy(new Error("x"))).toBe(false);
  });
});
