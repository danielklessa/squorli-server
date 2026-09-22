/**
 * The push-to-talk key for the system watch helper (docs/features/hotkeys.md): the client names it as `KeyboardEvent.code`
 * (a key's place on the keyboard, whatever the layout), the helper sees Windows' scan codes (set 1 make codes, the same
 * physical places) with Raw Input. This table is Chromium's own mapping between the two (ui/events/keycodes/dom); an
 * E0-prefixed code carries `E0_FLAG`. Pure, tested, no Electron import.
 */
export const E0_FLAG = 0x100;

const SCAN_CODES: Record<string, number> = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0A, Digit0: 0x0B, Minus: 0x0C, Equal: 0x0D, Backspace: 0x0E, Tab: 0x0F,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1A, BracketRight: 0x1B, Enter: 0x1C, ControlLeft: 0x1D,
  KeyA: 0x1E, KeyS: 0x1F, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2A, Backslash: 0x2B,
  KeyZ: 0x2C, KeyX: 0x2D, KeyC: 0x2E, KeyV: 0x2F, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3A,
  F1: 0x3B, F2: 0x3C, F3: 0x3D, F4: 0x3E, F5: 0x3F, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, NumLock: 0x45, ScrollLock: 0x46,
  Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4A, Numpad4: 0x4B, Numpad5: 0x4C, Numpad6: 0x4D, NumpadAdd: 0x4E, Numpad1: 0x4F, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53,
  IntlBackslash: 0x56, F11: 0x57, F12: 0x58, F13: 0x64, F14: 0x65, F15: 0x66, F16: 0x67, F17: 0x68, F18: 0x69, F19: 0x6A, F20: 0x6B, F21: 0x6C, F22: 0x6D, F23: 0x6E, F24: 0x76,
  MediaTrackPrevious: 0x10 | E0_FLAG, MediaTrackNext: 0x19 | E0_FLAG, NumpadEnter: 0x1C | E0_FLAG, ControlRight: 0x1D | E0_FLAG, AudioVolumeMute: 0x20 | E0_FLAG, MediaPlayPause: 0x22 | E0_FLAG, MediaStop: 0x24 | E0_FLAG,
  AudioVolumeDown: 0x2E | E0_FLAG, AudioVolumeUp: 0x30 | E0_FLAG, NumpadDivide: 0x35 | E0_FLAG, PrintScreen: 0x37 | E0_FLAG, AltRight: 0x38 | E0_FLAG,
  Home: 0x47 | E0_FLAG, ArrowUp: 0x48 | E0_FLAG, PageUp: 0x49 | E0_FLAG, ArrowLeft: 0x4B | E0_FLAG, ArrowRight: 0x4D | E0_FLAG, End: 0x4F | E0_FLAG, ArrowDown: 0x50 | E0_FLAG, PageDown: 0x51 | E0_FLAG, Insert: 0x52 | E0_FLAG, Delete: 0x53 | E0_FLAG,
  MetaLeft: 0x5B | E0_FLAG, MetaRight: 0x5C | E0_FLAG, ContextMenu: 0x5D | E0_FLAG,
};

/** The scan code (with `E0_FLAG` for an E0-prefixed key) of a `KeyboardEvent.code`; null = a key the helper cannot watch. */
export const scanCodeOf = (code: string): number | null => (Object.prototype.hasOwnProperty.call(SCAN_CODES, code) ? SCAN_CODES[code]! : null);

/** The helper's stdin line that replaces the watched keys: `keys<TAB><hex>...`, `keys` alone = none. */
export const keysLine = (scans: readonly number[]): string => (scans.length === 0 ? "keys" : `keys\t${scans.map((s) => s.toString(16)).join("\t")}`);
