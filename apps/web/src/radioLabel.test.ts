import { describe, expect, it } from "vitest";
import { fitsInstead } from "./radioLabel";

describe("radio button label", () => {
  it("shows the title when the row has room for it", () => {
    expect(fitsInstead({ wanted: 240, shown: 80, truncated: false, free: 300, max: 400 })).toBe(true);
    expect(fitsInstead({ wanted: 240, shown: 80, truncated: false, free: 160, max: 400 })).toBe(true); // exactly
    expect(fitsInstead({ wanted: 60, shown: 80, truncated: false, free: 0, max: 400 })).toBe(true); // shorter than the name
  });

  it("keeps the station's name when the title would not fit in full", () => {
    expect(fitsInstead({ wanted: 240, shown: 80, truncated: false, free: 100, max: 400 })).toBe(false);
    expect(fitsInstead({ wanted: 500, shown: 80, truncated: false, free: 900, max: 400 })).toBe(false); // wider than the button may get
    expect(fitsInstead({ wanted: 0, shown: 0, truncated: false, free: 900, max: 400 })).toBe(false); // nothing to show (hidden on phones)
  });

  it("has no room at all in a row that already cuts the label off, even for a title shorter than the name", () => {
    expect(fitsInstead({ wanted: 90, shown: 95, truncated: true, free: 0, max: 400 })).toBe(false);
  });

  it("answers the same whichever text is showing, so the label does not flip", () => {
    // Name showing: 80 px label, 160 px free. Title showing: 240 px label, nothing free. Same row, same answer.
    expect(fitsInstead({ wanted: 240, shown: 80, truncated: false, free: 160, max: 400 })).toBe(fitsInstead({ wanted: 240, shown: 240, truncated: false, free: 0, max: 400 }));
    // The window got narrower while the title shows: it is cut off (200 of 240 px) and nothing is free.
    expect(fitsInstead({ wanted: 240, shown: 200, truncated: true, free: 0, max: 400 })).toBe(false);
    // ... and with the name back (80 px) the 120 px that are free now are still not enough.
    expect(fitsInstead({ wanted: 240, shown: 80, truncated: false, free: 120, max: 400 })).toBe(false);
  });
});
