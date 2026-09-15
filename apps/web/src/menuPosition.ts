type Size = { width: number; height: number };
type Point = { x: number; y: number };

export function menuPosition(point: Point, menu: Size, viewport: Size) {
  return {
    left: Math.max(8, Math.min(point.x, viewport.width - menu.width - 8)),
    top: Math.max(8, Math.min(point.y, viewport.height - menu.height - 8)),
  };
}

export function submenuPosition(anchor: { left: number; right: number; top: number }, menu: Size, viewport: Size) {
  return menuPosition({ x: anchor.right + menu.width + 8 <= viewport.width ? anchor.right : anchor.left - menu.width, y: anchor.top }, menu, viewport);
}
