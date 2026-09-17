import { describe, expect, it } from "vitest";
import { menuPosition, submenuPosition } from "./menuPosition";

describe("context menu placement", () => {
  const viewport = { width: 1280, height: 720 };
  const menu = { width: 288, height: 400 };
  it("opens at the pointer with enough space", () => {
    expect(menuPosition({ x: 400, y: 100 }, menu, viewport)).toEqual({ left: 400, top: 100 });
  });
  it("keeps bottom-right actions inside the viewport", () => {
    expect(menuPosition({ x: 1279, y: 719 }, menu, viewport)).toEqual({ left: 984, top: 312 });
  });
  it("preserves a reachable top edge for oversized scrollable menus", () => {
    expect(menuPosition({ x: -5, y: 0 }, menu, { width: 280, height: 200 })).toEqual({ left: 8, top: 8 });
  });
  it("grows upwards from its bottom edge when asked to", () => {
    expect(menuPosition({ x: 96, y: 650, above: true }, menu, viewport)).toEqual({ left: 96, top: 250 });
  });
  it("keeps an upward menu inside the viewport", () => {
    expect(menuPosition({ x: 96, y: 300, above: true }, menu, viewport)).toEqual({ left: 96, top: 8 });
  });
  it("opens a submenu to the right when space allows", () => {
    expect(submenuPosition({ left: 400, right: 672, top: 100 }, menu, viewport)).toEqual({ left: 672, top: 100 });
  });
  it("flips the submenu left at the right edge", () => {
    expect(submenuPosition({ left: 992, right: 1264, top: 600 }, menu, viewport)).toEqual({ left: 704, top: 312 });
  });
  it("clamps submenus when neither side has sufficient space", () => {
    expect(submenuPosition({ left: 16, right: 280, top: 100 }, menu, { width: 320, height: 600 })).toEqual({ left: 8, top: 100 });
  });
});
