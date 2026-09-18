/**
 * Where the window was when it was closed (user's wish: it reopens there). Pure part (tested); `index.ts` stores it in
 * `desktop-config.json` and asks Electron for the displays.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type WindowState = { bounds: Rect; maximized: boolean };

export const DEFAULT_SIZE = { width: 1280, height: 820 };
export const MIN_SIZE = { width: 420, height: 480 };
/** How much of the window must lie on a display to count as reachable (a title bar's worth to grab it by). */
const VISIBLE_MIN = { width: 120, height: 48 };

const isRect = (v: unknown): v is Rect => typeof v === "object" && v !== null && (["x", "y", "width", "height"] as const).every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

/**
 * The stored state, made safe for the displays of today: a window that would open outside of every display (a monitor was
 * unplugged, the resolution changed) opens at the default place instead; sizes are clamped to the display it lands on.
 * `workAreas` = the usable rectangles of all displays. null = nothing usable stored.
 */
export function restoreWindowState(stored: unknown, workAreas: readonly Rect[]): WindowState | null {
  const s = (typeof stored === "object" && stored !== null ? stored : {}) as { bounds?: unknown; maximized?: unknown };
  if (!isRect(s.bounds)) return null;
  const b = { x: Math.round(s.bounds.x), y: Math.round(s.bounds.y), width: Math.round(s.bounds.width), height: Math.round(s.bounds.height) };
  const overlap = (a: Rect) => ({ width: Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x), height: Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y) });
  // The display that shows most of the window; its top edge must be on it, or the title bar could not be reached.
  const area = workAreas.map((a) => ({ a, o: overlap(a) })).filter(({ a, o }) => o.width >= VISIBLE_MIN.width && o.height >= VISIBLE_MIN.height && b.y >= a.y - 8 && b.y <= a.y + a.height - VISIBLE_MIN.height)
    .sort((p, q) => q.o.width * q.o.height - p.o.width * p.o.height)[0]?.a;
  if (!area) return null;
  const width = Math.max(MIN_SIZE.width, Math.min(b.width, area.width)), height = Math.max(MIN_SIZE.height, Math.min(b.height, area.height));
  return { bounds: { x: b.x, y: b.y, width, height }, maximized: s.maximized === true };
}
