import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";
import type { VoiceClient } from "./voice/voiceClient";

/**
 * Push-to-talk on a phone or tablet (22 September 2026, user's wish): there is no key to assign, so the stage shows a
 * button above its bar that opens the microphone while it is held, and the dock (the minimised voice chat) one in the
 * place of its mute button (`compact`). Both show it when `platform.mobile` and the mode is "ptt"; a keyboard on an
 * iPad still works through `usePushToTalk`. The icon is the sound waves, not a microphone, so nobody takes it for the
 * mute button (user's wish).
 * Pointer events with capture, so a finger that slides off the button still releases it; a lost capture, the window
 * losing focus, the page going hidden and unmounting (the stage closes under the finger) release too. The long-press
 * menu, scrolling and text selection are turned off on the button (`.ptt-btn`: touch-action, user-select; contextmenu
 * here), or the browser would take the press. Enter and Space hold it from a keyboard for whoever focuses the button.
 * `disabled`: muted or in the AFK channel, where an open gate would change nothing.
 */
export function PushToTalkButton({ client, disabled, compact = false }: { client: VoiceClient; disabled: boolean; compact?: boolean }) {
  const [held, setHeld] = useState(false);
  const clientRef = useRef(client);
  clientRef.current = client;
  const hold = (on: boolean) => { setHeld(on); clientRef.current.setPttHeld(on); };

  useEffect(() => {
    const release = () => { setHeld(false); clientRef.current.setPttHeld(false); };
    const hidden = () => { if (document.visibilityState === "hidden") release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", hidden); release(); };
  }, []);
  useEffect(() => { if (disabled) hold(false); }, [disabled]);

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    hold(true);
  };
  const up = () => hold(false);
  const isHoldKey = (e: ReactKeyboardEvent) => e.key === " " || e.key === "Enter";

  return (
    <button type="button" className={`ptt-btn ${compact ? "compact" : ""} ${held ? "held" : ""}`} disabled={disabled} aria-pressed={held}
      aria-label={t("stage.pttHold")}
      onPointerDown={down} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onBlur={up}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (isHoldKey(e)) { e.preventDefault(); if (!e.repeat && !disabled) hold(true); } }}
      onKeyUp={(e) => { if (isHoldKey(e)) { e.preventDefault(); up(); } }}>
      <Icon name="audio-lines" /> {compact ? t(held ? "dock.pttOpen" : "dock.pttHold") : t(held ? "stage.pttOpen" : "stage.pttHold")}
    </button>
  );
}
