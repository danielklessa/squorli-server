import { describe, expect, it } from "vitest";
import { isTypingTarget } from "./usePushToTalk";

// Elements of a pop-out window are no `HTMLElement` of the main window, so the check must not rely on `instanceof`.
describe("isTypingTarget", () => {
  const target = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;

  it("keeps the push-to-talk key out of fields the user types in", () => {
    expect(isTypingTarget(target("INPUT"))).toBe(true);
    expect(isTypingTarget(target("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(target("SELECT"))).toBe(true);
    expect(isTypingTarget(target("DIV", true))).toBe(true);
  });

  it("lets the key through everywhere else", () => {
    expect(isTypingTarget(target("BUTTON"))).toBe(false);
    expect(isTypingTarget(target("DIV"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false); // a window or document as the target
  });
});
