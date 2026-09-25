import { useEffect, useRef } from "react";
import { useVoiceSettings } from "./voice/useVoiceSettings";
import type { VoiceClient } from "./voice/voiceClient";

/** Duck-typed on purpose: an element of a pop-out window is no `HTMLElement` of this window. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as Partial<HTMLElement> | null;
  return !!el && typeof el.tagName === "string" && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true);
};

/**
 * Push-to-talk for one window: only while that window has focus (a platform limit in the browser; the desktop app's global key: docs/features/hotkeys.md). The main
 * window (VoiceDock) and the stage's window of its own (StageWindow) each listen for themselves.
 * `suspended`: the settings dialog is capturing a new key, that key press must not open the microphone.
 */
export function usePushToTalk(win: Window, client: VoiceClient, joined: boolean, suspended: boolean) {
  const settings = useVoiceSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    if (!joined || settings.mode !== "ptt") { client.setPttHeld(false); return; }
    const down = (e: KeyboardEvent) => {
      if (suspended || isTypingTarget(e.target) || e.code !== settingsRef.current.pttKey) return;
      e.preventDefault();
      if (!e.repeat) client.setPttHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === settingsRef.current.pttKey) client.setPttHeld(false); };
    const release = () => client.setPttHeld(false);
    win.addEventListener("keydown", down); win.addEventListener("keyup", up); win.addEventListener("blur", release);
    return () => { win.removeEventListener("keydown", down); win.removeEventListener("keyup", up); win.removeEventListener("blur", release); release(); };
  }, [win, joined, settings.mode, suspended, client]);
}
