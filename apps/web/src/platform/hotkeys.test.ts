import { describe, expect, it } from "vitest";
import { checkHotkey, controlLink, formatHotkey, hotkeyAccelerator, hotkeyFromKey, keyLabel, normalizeHotkeys, parseControlAction, sameHotkeys } from "./hotkeys";

const names = { ctrl: "Strg", alt: "Alt", shift: "Umschalt", meta: "Win" };
const key = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe("hotkeyFromKey", () => {
  it("takes the key with the modifiers held, and waits while only a modifier is down", () => {
    expect(hotkeyFromKey(key("KeyM", { ctrlKey: true, shiftKey: true }))).toEqual({ code: "KeyM", ctrl: true, alt: false, shift: true, meta: false });
    for (const code of ["ControlLeft", "ShiftRight", "AltLeft", "MetaRight", "AltGraph", "OSLeft"]) expect(hotkeyFromKey(key(code, { ctrlKey: true })), code).toBeNull();
    expect(hotkeyFromKey(key(""))).toBeNull();
    expect(hotkeyFromKey(key("Key M"))).toBeNull();
  });
});

describe("hotkeyAccelerator", () => {
  it("names the keys as Electron does", () => {
    expect(hotkeyAccelerator({ code: "KeyM", ctrl: true, alt: false, shift: true, meta: false })).toBe("Control+Shift+M");
    expect(hotkeyAccelerator({ code: "Digit1", ctrl: false, alt: true, shift: false, meta: false })).toBe("Alt+1");
    expect(hotkeyAccelerator({ code: "F13", ctrl: false, alt: false, shift: false, meta: false })).toBe("F13");
    expect(hotkeyAccelerator({ code: "Numpad5", ctrl: false, alt: false, shift: false, meta: false })).toBe("num5");
    expect(hotkeyAccelerator({ code: "NumpadAdd", ctrl: false, alt: false, shift: false, meta: false })).toBe("numadd");
    expect(hotkeyAccelerator({ code: "AudioVolumeMute", ctrl: false, alt: false, shift: false, meta: false })).toBe("VolumeMute");
    expect(hotkeyAccelerator({ code: "ArrowUp", ctrl: true, alt: false, shift: false, meta: true })).toBe("Control+Super+Up");
    expect(hotkeyAccelerator({ code: "Space", ctrl: true, alt: false, shift: false, meta: false })).toBe("Control+Space");
    expect(hotkeyAccelerator({ code: "Backquote", ctrl: false, alt: true, shift: false, meta: false })).toBe("Alt+`");
  });
  it("refuses a key nobody could type without, and keys it cannot name", () => {
    expect(checkHotkey({ code: "KeyM", ctrl: false, alt: false, shift: false, meta: false })).toBe("needsModifier");
    expect(checkHotkey({ code: "Space", ctrl: false, alt: false, shift: false, meta: false })).toBe("needsModifier");
    expect(checkHotkey({ code: "F24", ctrl: false, alt: false, shift: false, meta: false })).toBe("ok");
    expect(checkHotkey({ code: "IntlBackslash", ctrl: true, alt: false, shift: false, meta: false })).toBe("unknownKey");
    expect(checkHotkey({ code: "Pause", ctrl: true, alt: false, shift: false, meta: false })).toBe("unknownKey");
    expect(hotkeyAccelerator({ code: "KeyM", ctrl: false, alt: false, shift: false, meta: false })).toBeNull();
  });
});

describe("normalizeHotkeys", () => {
  it("keeps what is well-formed and drops the rest", () => {
    expect(normalizeHotkeys(undefined)).toEqual({ micToggle: null, deafenToggle: null });
    expect(normalizeHotkeys({ micToggle: { code: "KeyM", ctrl: true }, deafenToggle: { code: "Control Left", ctrl: "yes" } })).toEqual({ micToggle: { code: "KeyM", ctrl: true, alt: false, shift: false, meta: false }, deafenToggle: null });
    expect(normalizeHotkeys({ micToggle: { code: "ShiftLeft", ctrl: true } })).toEqual({ micToggle: null, deafenToggle: null });
    expect(sameHotkeys(normalizeHotkeys({ micToggle: { code: "F13" } }), { micToggle: { code: "F13", ctrl: false, alt: false, shift: false, meta: false }, deafenToggle: null })).toBe(true);
  });
});

describe("formatHotkey and keyLabel", () => {
  it("shows the modifiers in the caller's words and the key by its code", () => {
    expect(formatHotkey({ code: "KeyM", ctrl: true, alt: false, shift: true, meta: false }, names)).toBe("Strg+Umschalt+M");
    expect(formatHotkey({ code: "Numpad5", ctrl: false, alt: true, shift: false, meta: true }, names)).toBe("Alt+Win+Num 5");
    expect(keyLabel("F13")).toBe("F13");
    expect(keyLabel("NumpadAdd")).toBe("Num +");
    expect(keyLabel("ArrowLeft")).toBe("Left");
    expect(keyLabel("PageDown")).toBe("Page Down");
    expect(keyLabel("AudioVolumeMute")).toBe("Volume Mute");
  });
});

describe("parseControlAction", () => {
  it("reads control links, bare actions and nothing else", () => {
    expect(parseControlAction("squorli://control/mic-toggle")).toBe("mic-toggle");
    expect(parseControlAction("SQUORLI://control/Deafen-On/")).toBe("deafen-on");
    expect(parseControlAction("squorli:control/mic-off")).toBe("mic-off");
    expect(parseControlAction("mic-on")).toBe("mic-on");
    expect(parseControlAction(controlLink("deafen-toggle"))).toBe("deafen-toggle");
    for (const raw of ["squorli://control/quit", "squorli://server/example.org", "squorli://control/mic-toggle?x=1", "", "control/mic-toggle", "x".repeat(200)]) expect(parseControlAction(raw), raw).toBeNull();
  });
});
