import { describe, expect, it, vi } from "vitest";
import { attachVideoView, fitVideoWindow, toggleVideoFullscreen, watchDocumentHidden } from "./videoDisplay";

describe("video window sizing", () => {
  it("uses landscape, portrait and ultrawide video proportions", () => {
    expect(fitVideoWindow(16 / 9, 960, 1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(fitVideoWindow(9 / 16, 960, 1920, 960)).toEqual({ width: 540, height: 960 });
    expect(fitVideoWindow(32 / 9, 960, 1920, 1080)).toEqual({ width: 960, height: 270 });
  });
  it("limits both dimensions to the available screen area", () => {
    expect(fitVideoWindow(4 / 3, 960, 640, 900)).toEqual({ width: 640, height: 480 });
    expect(fitVideoWindow(4 / 3, 960, 1920, 600)).toEqual({ width: 800, height: 600 });
  });
  it("uses a fallback until video dimensions are available", () => {
    expect(fitVideoWindow(NaN, 960, 1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(fitVideoWindow(0, 960, 1920, 1080)).toEqual({ width: 960, height: 540 });
  });
});

describe("pausing a video nobody sees, per window", () => {
  function fakeDocument() {
    const listeners = new Set<() => void>();
    const doc = { hidden: false, addEventListener: (_: "visibilitychange", fn: () => void) => { listeners.add(fn); }, removeEventListener: (_: "visibilitychange", fn: () => void) => { listeners.delete(fn); } };
    return { doc, listeners, set: (hidden: boolean) => { doc.hidden = hidden; for (const fn of [...listeners]) fn(); } };
  }
  it("reports a document hidden for a while, not a short look at another tab, and visible again at once", () => {
    vi.useFakeTimers();
    try {
      const { doc, set, listeners } = fakeDocument();
      const seen: boolean[] = [];
      const stop = watchDocumentHidden(doc, (hidden) => seen.push(hidden));
      set(true); vi.advanceTimersByTime(3000); set(false); vi.advanceTimersByTime(10_000);
      expect(seen).toEqual([]);
      set(true); vi.advanceTimersByTime(4999);
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(seen).toEqual([true]);
      set(false);
      expect(seen).toEqual([true, false]);
      set(true); stop(); vi.advanceTimersByTime(10_000);
      expect(seen).toEqual([true, false]);
      expect(listeners.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("starts the clock for a document that is already hidden", () => {
    vi.useFakeTimers();
    try {
      const { doc } = fakeDocument();
      doc.hidden = true;
      const seen: boolean[] = [];
      watchDocumentHidden(doc, (hidden) => seen.push(hidden), 1000);
      vi.advanceTimersByTime(1000);
      expect(seen).toEqual([true]);
    } finally { vi.useRealTimers(); }
  });
});

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
