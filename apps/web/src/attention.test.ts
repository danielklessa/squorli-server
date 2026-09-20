import { describe, expect, it } from "vitest";
import { attentionCount, seesIncoming } from "./attention";

describe("attention", () => {
  it("takes a message for seen only in a focused, visible window that shows its conversation", () => {
    expect(seesIncoming({ visible: true, focused: true }, true)).toBe(true);
    expect(seesIncoming({ visible: true, focused: false }, true)).toBe(false);
    expect(seesIncoming({ visible: false, focused: false }, true)).toBe(false);
    expect(seesIncoming({ visible: true, focused: true }, false)).toBe(false);
  });

  it("counts unread direct messages and mentions, and what arrived unseen in the open conversation", () => {
    expect(attentionCount([], [], 0)).toBe(0);
    expect(attentionCount([2, 0], [1, 3], 0)).toBe(6);
    expect(attentionCount([1], [], 1)).toBe(1); // the same message: counted once
    expect(attentionCount([], [], 2)).toBe(2);  // mentions in the channel that is open while the window is minimized
  });
});
