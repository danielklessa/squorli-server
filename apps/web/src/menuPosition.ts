type Size = { width: number; height: number };
/** `above`: the menu grows upwards, its bottom edge sits at `y` (for triggers at the bottom of the window, like the dock). */
type Point = { x: number; y: number; above?: boolean };

export function menuPosition(point: Point, menu: Size, viewport: Size) {
  const top = point.above ? point.y - menu.height : point.y;
  return {
    left: Math.max(8, Math.min(point.x, viewport.width - menu.width - 8)),
    top: Math.max(8, Math.min(top, viewport.height - menu.height - 8)),
  };
}

export function submenuPosition(anchor: { left: number; right: number; top: number }, menu: Size, viewport: Size) {
  return menuPosition({ x: anchor.right + menu.width + 8 <= viewport.width ? anchor.right : anchor.left - menu.width, y: anchor.top }, menu, viewport);
}
