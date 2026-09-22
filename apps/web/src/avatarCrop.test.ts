import { describe, expect, it } from "vitest";
import { clampView, cropRect, initialView, maxZoom, panBy, sliderToZoom, zoomAt, zoomToSlider } from "./avatarCrop";

const landscape = { width: 720, height: 700 };
const portrait = { width: 300, height: 900 };

describe("avatar crop", () => {
  it("starts with the centered square of before", () => {
    expect(cropRect(landscape, initialView(landscape))).toEqual({ x: 10, y: 0, side: 700 });
    expect(cropRect(portrait, initialView(portrait))).toEqual({ x: 0, y: 300, side: 300 });
  });
  it("keeps the crop inside the image and the zoom within its range", () => {
    expect(clampView(landscape, { zoom: 0.5, cx: -100, cy: 5000 })).toEqual({ zoom: 1, cx: 350, cy: 350 });
    expect(clampView(landscape, { zoom: 9, cx: 0, cy: 0 })).toEqual({ zoom: 4, cx: 87.5, cy: 87.5 });
    expect(maxZoom({ width: 64, height: 40 })).toBe(1.25); // 40 / 32
    expect(maxZoom({ width: 20, height: 20 })).toBe(1);
  });
  it("pans by frame pixels against the drag direction and stops at the edge", () => {
    // zoom 1, side 700 shown in a 350 px frame: 2 image pixels per frame pixel; there are 10 px of slack horizontally.
    expect(panBy(landscape, initialView(landscape), -3, 0, 350)).toEqual({ zoom: 1, cx: 366, cy: 350 });
    expect(panBy(landscape, initialView(landscape), -50, 20, 350)).toEqual({ zoom: 1, cx: 370, cy: 350 });
  });
  it("zooms around the focus point", () => {
    const zoomed = zoomAt(landscape, initialView(landscape), 2, { fx: 0, fy: 0 });
    // the image point at the frame's top-left corner (10, 0) stays there
    expect(cropRect(landscape, zoomed)).toEqual({ x: 10, y: 0, side: 350 });
    const centered = zoomAt(landscape, initialView(landscape), 2);
    expect(cropRect(landscape, centered)).toEqual({ x: 185, y: 175, side: 350 });
    expect(zoomAt(landscape, centered, 0.5)).toEqual(initialView(landscape));
  });
  it("maps the slider linearly onto the zoom range", () => {
    expect(zoomToSlider(landscape, 1)).toBe(0);
    expect(zoomToSlider(landscape, 4)).toBe(100);
    expect(sliderToZoom(landscape, 50)).toBe(2.5);
    expect(zoomToSlider({ width: 20, height: 20 }, 1)).toBe(0);
  });
});
