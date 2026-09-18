import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { COLUMN_LIMITS, clampColumn, draggedWidth, type ColumnId } from "./layout";

/**
 * Drag handle in the gap next to a side column: changes that column's width. Pointer (captured, so the drag survives
 * leaving the narrow handle), keyboard (arrow keys, Home = back to the default) and a double click (default). It lies over
 * the gap as an absolutely placed grid child (styles.css `.col-handle`), so it takes no cell of the layout.
 */
export function ColumnHandle({ column, width, label, onChange, onCommit }: {
  column: ColumnId; width: number; label: string;
  /** While dragging: the width to show. */
  onChange: (width: number) => void;
  /** Drag finished or a key pressed: the width to keep. */
  onCommit: (width: number) => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null);
  const limits = COLUMN_LIMITS[column];

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, last: width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.last = draggedWidth(column, d.startWidth, e.clientX - d.startX);
    onChange(d.last);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit(d.last);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Arrow right always moves the handle to the right: the left column grows, the member list shrinks.
    const step = e.shiftKey ? 48 : 16;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : null;
    if (dx !== null) { e.preventDefault(); onCommit(draggedWidth(column, width, dx)); }
    else if (e.key === "Home") { e.preventDefault(); onCommit(limits.initial); }
  };

  return (
    <div className={`col-handle for-${column}`} role="separator" aria-orientation="vertical" aria-label={label} title={label} tabIndex={0}
      aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={clampColumn(column, width)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => onCommit(limits.initial)} onKeyDown={onKeyDown} />
  );
}
