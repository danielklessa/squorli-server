/**
 * Widths of the two side columns (channel list on the left, member list on the right), which the user drags (user's wish,
 * 18 September 2026). Per device in localStorage; pure functions plus storage, the handles live in `ColumnHandle.tsx`.
 */
export type ColumnId = "left" | "members";
export type Layout = Record<ColumnId, number>;

/** CSS pixels. The defaults equal the former fixed widths (17rem and 15rem at 16 px). */
export const COLUMN_LIMITS: Record<ColumnId, { min: number; max: number; initial: number }> = {
  left: { min: 208, max: 448, initial: 272 },
  members: { min: 176, max: 416, initial: 240 },
};
export const DEFAULT_LAYOUT: Layout = { left: COLUMN_LIMITS.left.initial, members: COLUMN_LIMITS.members.initial };
const LAYOUT_KEY = "chat.layout.v1";

export function clampColumn(id: ColumnId, width: unknown): number {
  const { min, max, initial } = COLUMN_LIMITS[id];
  return typeof width === "number" && Number.isFinite(width) ? Math.round(Math.min(max, Math.max(min, width))) : initial;
}

export function parseLayout(raw: string | null): Layout {
  try {
    const v = raw ? JSON.parse(raw) as Partial<Record<ColumnId, unknown>> | null : null;
    if (typeof v !== "object" || v === null) return DEFAULT_LAYOUT;
    return { left: clampColumn("left", v.left), members: clampColumn("members", v.members) };
  } catch { return DEFAULT_LAYOUT; }
}

/**
 * Width of a column while its handle is dragged by `dx` pixels: the left column grows to the right, the member list (whose
 * handle is on its left edge) grows to the left.
 */
export function draggedWidth(id: ColumnId, startWidth: number, dx: number): number {
  return clampColumn(id, id === "left" ? startWidth + dx : startWidth - dx);
}

export function loadLayout(): Layout {
  try { return parseLayout(localStorage.getItem(LAYOUT_KEY)); } catch { return DEFAULT_LAYOUT; }
}
export function saveLayout(layout: Layout): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* never mind */ }
}
