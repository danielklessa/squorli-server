import { describe, expect, it } from "vitest";
import { COLUMN_LIMITS, DEFAULT_LAYOUT, clampColumn, draggedWidth, parseLayout } from "./layout";

describe("layout", () => {
  it("keeps a column inside its limits", () => {
    expect(clampColumn("left", 300)).toBe(300);
    expect(clampColumn("left", 10)).toBe(COLUMN_LIMITS.left.min);
    expect(clampColumn("members", 9999)).toBe(COLUMN_LIMITS.members.max);
    expect(clampColumn("members", Number.NaN)).toBe(COLUMN_LIMITS.members.initial);
    expect(clampColumn("left", "300")).toBe(COLUMN_LIMITS.left.initial);
  });

  it("grows the left column to the right and the member list to the left", () => {
    expect(draggedWidth("left", 272, 40)).toBe(312);
    expect(draggedWidth("left", 272, -400)).toBe(COLUMN_LIMITS.left.min);
    expect(draggedWidth("members", 240, -40)).toBe(280);
    expect(draggedWidth("members", 240, 400)).toBe(COLUMN_LIMITS.members.min);
  });

  it("reads what was stored and survives rubbish", () => {
    expect(parseLayout(JSON.stringify({ left: 320, members: 200 }))).toEqual({ left: 320, members: 200 });
    expect(parseLayout(JSON.stringify({ left: 5 }))).toEqual({ left: COLUMN_LIMITS.left.min, members: COLUMN_LIMITS.members.initial });
    for (const raw of [null, "", "{", "null", "7", "[]"]) expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT);
  });
});
