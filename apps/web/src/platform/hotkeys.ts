import type { ControlAction, HotkeyAction, HotkeyBinding, HotkeyBindings } from "./bridge";

/**
 * Global shortcuts of the desktop app and the commands from outside (docs/features/hotkeys.md): the rules both sides share.
 * DOM-free: the Electron main process bundles this file too (package export `./platform/hotkeys`). The client captures a
 * binding from a key event and shows it; the shell turns it into Electron's accelerator and registers it.
 */

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = ["micToggle", "deafenToggle"];
export const CONTROL_ACTIONS: readonly ControlAction[] = ["mic-toggle", "mic-on", "mic-off", "deafen-toggle", "deafen-on", "deafen-off"];
export const NO_HOTKEYS: HotkeyBindings = { micToggle: null, deafenToggle: null };

const CODE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

/** A stored binding made safe: the key must look like a `KeyboardEvent.code`, the modifiers are booleans; anything else = none. */
export function normalizeHotkey(value: unknown): HotkeyBinding | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.code !== "string" || !CODE.test(v.code) || isModifierCode(v.code)) return null;
  return { code: v.code, ctrl: v.ctrl === true, alt: v.alt === true, shift: v.shift === true, meta: v.meta === true };
}

export function normalizeHotkeys(value: unknown): HotkeyBindings {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { micToggle: normalizeHotkey(v.micToggle), deafenToggle: normalizeHotkey(v.deafenToggle) };
}

export const sameHotkey = (a: HotkeyBinding | null, b: HotkeyBinding | null): boolean =>
  a === b || (!!a && !!b && a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta);

export const sameHotkeys = (a: HotkeyBindings, b: HotkeyBindings): boolean => HOTKEY_ACTIONS.every((action) => sameHotkey(a[action], b[action]));

/** A modifier key by itself (`ControlLeft`, `ShiftRight`, ...): never a binding's key, the capture waits for the next key. */
export const isModifierCode = (code: string): boolean => /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code) || code === "AltGraph";

/** The binding a key event describes; null while only a modifier is down. */
export function hotkeyFromKey(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): HotkeyBinding | null {
  if (!CODE.test(e.code) || isModifierCode(e.code)) return null;
  return { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

const NAMED: Record<string, string> = {
  Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Escape: "Escape",
  Enter: "Return", NumpadEnter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  NumpadDecimal: "numdec", NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\", Comma: ",", Period: ".", Slash: "/",
  CapsLock: "Capslock", NumLock: "Numlock", ScrollLock: "Scrolllock", PrintScreen: "PrintScreen",
  AudioVolumeUp: "VolumeUp", AudioVolumeDown: "VolumeDown", AudioVolumeMute: "VolumeMute", MediaPlayPause: "MediaPlayPause", MediaTrackNext: "MediaNextTrack", MediaTrackPrevious: "MediaPreviousTrack", MediaStop: "MediaStop",
};

/** The key's name in Electron's accelerator; null = a key an accelerator cannot name. */
export function acceleratorKey(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1]!;
  m = /^Digit([0-9])$/.exec(code); if (m) return m[1]!;
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code); if (m) return `F${m[1]}`;
  m = /^Numpad([0-9])$/.exec(code); if (m) return `num${m[1]}`;
  return NAMED[code] ?? null;
}

/**
 * A key without a modifier is left to the other programs, unless nobody types with it: the function keys (F13 to F24 are
 * what a Stream Deck or G Hub sends), the number pad and the media keys.
 */
export const bareKeyAllowed = (code: string): boolean => /^(F([1-9]|1[0-9]|2[0-4])|Numpad[A-Za-z0-9]+|AudioVolume(Up|Down|Mute)|Media(PlayPause|TrackNext|TrackPrevious|Stop))$/.test(code);

export type HotkeyCheck = "ok" | "needsModifier" | "unknownKey";
export function checkHotkey(binding: HotkeyBinding): HotkeyCheck {
  if (acceleratorKey(binding.code) === null) return "unknownKey";
  if (!(binding.ctrl || binding.alt || binding.shift || binding.meta) && !bareKeyAllowed(binding.code)) return "needsModifier";
  return "ok";
}

/** Electron's accelerator for a binding (`Control+Shift+M`, `F13`, `Alt+num5`); null when the binding fails the check. */
export function hotkeyAccelerator(binding: HotkeyBinding): string | null {
  if (checkHotkey(binding) !== "ok") return null;
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Control");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  if (binding.meta) parts.push("Super");
  parts.push(acceleratorKey(binding.code)!);
  return parts.join("+");
}

/** A key's short label for the settings (from its code, as the push-to-talk key is shown): `M`, `F13`, `Num 5`, `Space`. */
export function keyLabel(code: string): string {
  let m = /^(Key|Digit)(.+)$/.exec(code); if (m) return m[2]!;
  m = /^Numpad(.+)$/.exec(code);
  if (m) return `Num ${({ Decimal: ".", Add: "+", Subtract: "-", Multiply: "*", Divide: "/", Enter: "Enter" } as Record<string, string>)[m[1]!] ?? m[1]}`;
  m = /^Arrow(.+)$/.exec(code); if (m) return m[1]!;
  m = /^AudioVolume(.+)$/.exec(code); if (m) return `Volume ${m[1]}`;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export type ModifierNames = { ctrl: string; alt: string; shift: string; meta: string };
export function formatHotkey(binding: HotkeyBinding, names: ModifierNames): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push(names.ctrl);
  if (binding.alt) parts.push(names.alt);
  if (binding.shift) parts.push(names.shift);
  if (binding.meta) parts.push(names.meta);
  parts.push(keyLabel(binding.code));
  return parts.join("+");
}

export const CONTROL_SCHEME_PREFIX = "squorli://control/";
export const controlLink = (action: ControlAction): string => `${CONTROL_SCHEME_PREFIX}${action}`;

/** The action a control link (`squorli://control/<action>`, also without the slashes) or a bare action name means; null for anything else. */
export function parseControlAction(raw: string): ControlAction | null {
  if (typeof raw !== "string" || raw.length > 100) return null;
  const m = /^(?:squorli:(?:\/\/)?control\/)?([a-z-]+)\/?$/i.exec(raw.trim());
  if (!m) return null;
  const action = m[1]!.toLowerCase();
  return (CONTROL_ACTIONS as readonly string[]).includes(action) ? action as ControlAction : null;
}
