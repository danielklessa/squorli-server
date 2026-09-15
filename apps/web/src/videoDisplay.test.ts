import { describe, expect, it, vi } from "vitest";
import { attachVideoView, toggleVideoFullscreen } from "./videoDisplay";

describe("video fullscreen", () => {
  it("requests fullscreen on the selected video container", async () => {
    const element = { requestFullscreen: vi.fn().mockResolvedValue(undefined), ownerDocument: { fullscreenElement: null, exitFullscreen: vi.fn() } };
    expect(await toggleVideoFullscreen(element)).toBe(true);
    expect(element.requestFullscreen).toHaveBeenCalledOnce();
    expect(element.ownerDocument.exitFullscreen).not.toHaveBeenCalled();
  });
  it("exits through the container's document, including a popup document", async () => {
    const element = { requestFullscreen: vi.fn(), ownerDocument: { fullscreenElement: {}, exitFullscreen: vi.fn().mockResolvedValue(undefined) } };
    await toggleVideoFullscreen(element);
    expect(element.ownerDocument.exitFullscreen).toHaveBeenCalledOnce();
    expect(element.requestFullscreen).not.toHaveBeenCalled();
  });
  it("reports an unsupported API without throwing", async () => {
    expect(await toggleVideoFullscreen({ ownerDocument: { fullscreenElement: null, exitFullscreen: vi.fn() } })).toBe(false);
  });
  it("propagates denied fullscreen for the visible error message", async () => {
    const error = new Error("denied");
    await expect(toggleVideoFullscreen({ requestFullscreen: vi.fn().mockRejectedValue(error), ownerDocument: { fullscreenElement: null, exitFullscreen: vi.fn() } })).rejects.toBe(error);
  });
});

describe("shared video views", () => {
  it("detaches only the closed view without stopping the shared stream", () => {
    const track = { attach: vi.fn(), detach: vi.fn(), stop: vi.fn() };
    const main = {}, popup = {};
    const closeMain = attachVideoView(track, main);
    const closePopup = attachVideoView(track, popup);
    closePopup();
    expect(track.attach.mock.calls).toEqual([[main], [popup]]);
    expect(track.detach.mock.calls).toEqual([[popup]]);
    expect(track.stop).not.toHaveBeenCalled();
    closeMain();
    expect(track.detach.mock.calls).toEqual([[popup], [main]]);
  });
});
