import { useEffect, useState } from "react";
import type { KeyLayout } from "./platform/hotkeys";

/**
 * What the user's keyboard layout writes with each key (docs/features/hotkeys.md, 24 September 2026), so a key is shown as
 * `Ö` and not as its code `Semicolon`. Chromium's Keyboard API (the desktop app, Chrome, Edge); null elsewhere, then the
 * labels fall back to the code. Read again whenever the window gets the focus: the layout may have been switched meanwhile.
 */
type LayoutMap = { get(code: string): string | undefined };
type KeyboardApi = { getLayoutMap(): Promise<LayoutMap> };

export function useKeyboardLayout(): KeyLayout | null {
  const [layout, setLayout] = useState<KeyLayout | null>(null);
  useEffect(() => {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard;
    if (!keyboard?.getLayoutMap) return;
    let alive = true;
    const load = () => { keyboard.getLayoutMap().then((map) => { if (alive) setLayout(() => (code: string) => map.get(code)); }).catch(() => {}); };
    load();
    window.addEventListener("focus", load);
    return () => { alive = false; window.removeEventListener("focus", load); };
  }, []);
  return layout;
}
