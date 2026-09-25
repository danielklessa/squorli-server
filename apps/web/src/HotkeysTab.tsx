import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { platform, type ControlAction, type HotkeyAction, type HotkeyBindings, type HotkeyStatus } from "./platform";
import { CONTROL_ACTIONS, HOTKEY_ACTIONS, controlLink, formatHotkey, keyName, type HotkeyCheck, type KeyLayout } from "./platform/hotkeys";
import type { VoiceSettings } from "./voice/settings";

/** Einstellungen > Tastenkürzel (desktop app only, docs/features/hotkeys.md): the global shortcuts, what the push-to-talk key does outside the window, and the commands for a Stream Deck, G Hub or any macro tool. */

const ACTION_LABELS: Record<HotkeyAction, string> = { micToggle: t("hotkeys.micToggle"), deafenToggle: t("hotkeys.deafenToggle") };
const CONTROL_LABELS: Record<ControlAction, string> = {
  "mic-toggle": t("hotkeys.action.micToggle"), "mic-on": t("hotkeys.action.micOn"), "mic-off": t("hotkeys.action.micOff"),
  "deafen-toggle": t("hotkeys.action.deafenToggle"), "deafen-on": t("hotkeys.action.deafenOn"), "deafen-off": t("hotkeys.action.deafenOff"),
};
const MODIFIER_NAMES = { ctrl: t("hotkeys.mod.ctrl"), alt: t("hotkeys.mod.alt"), shift: t("hotkeys.mod.shift"), meta: t("hotkeys.mod.meta") };
const CHECK_TEXTS: Record<Exclude<HotkeyCheck, "ok">, string> = { needsModifier: t("hotkeys.needsModifier"), unknownKey: t("hotkeys.unknownKey") };

export function HotkeysTab({ settings, bindings, layout, status, capturing, refused, onCapture, onRemove }: {
  settings: VoiceSettings; bindings: HotkeyBindings;
  /** The keyboard layout for the key labels (keyboardLayout.ts); null = labels from the key codes. */
  layout: KeyLayout | null;
  /** What the shell made of the bindings; null until it answered. */
  status: HotkeyStatus | null;
  /** The action whose key is being captured right now (the dialog owns the capture: it also quiets the shell meanwhile). */
  capturing: HotkeyAction | null;
  /** Why the last captured key was not taken; null = it was. */
  refused: { action: HotkeyAction; check: Exclude<HotkeyCheck, "ok"> } | null;
  onCapture: (action: HotkeyAction | null) => void; onRemove: (action: HotkeyAction) => void;
}) {
  const shell = platform.hotkeys;
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 1500); return () => clearTimeout(timer); }, [copied]);
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => setCopied(text)).catch(() => {}); };
  const stateText = (action: HotkeyAction): string | null => {
    if (!bindings[action] || !status) return null;
    const state = status[action];
    return state === "taken" ? t("hotkeys.taken") : state === "invalid" ? t("hotkeys.invalid") : state === "ok" ? t("hotkeys.active") : null;
  };
  const executable = shell?.executable ?? null;
  const pttKey = keyName(settings.pttKey, layout);
  return (
    <div className="stack">
      <h3>{t("hotkeys.head")}</h3>
      <span className="muted small">{t("hotkeys.intro")}</span>
      {HOTKEY_ACTIONS.map((action) => {
        const binding = bindings[action];
        const note = refused?.action === action ? CHECK_TEXTS[refused.check] : stateText(action);
        return (
          <div className="stack hotkey-row" key={action}>
            <div className="row">
              <span className="hotkey-label">{ACTION_LABELS[action]}</span>
              <kbd>{capturing === action ? t("hotkeys.pressKeys") : binding ? formatHotkey(binding, MODIFIER_NAMES, layout) : t("hotkeys.none")}</kbd>
              <button className="secondary small" onClick={() => onCapture(capturing === action ? null : action)}>{capturing === action ? t("common.cancel") : binding ? t("settings.change") : t("hotkeys.set")}</button>
              {binding && capturing !== action && <button className="secondary small" onClick={() => onRemove(action)}>{t("hotkeys.remove")}</button>}
            </div>
            {capturing === action ? <span className="muted small">{t("hotkeys.captureHint")}</span> : note && <span className={`small ${refused?.action === action || (status && status[action] !== "ok") ? "warn" : "muted"}`}>{note}</span>}
          </div>
        );
      })}
      <span className="muted small">{t("hotkeys.rule")}</span>
      <span className="muted small">{t("hotkeys.feedback")}</span>
      {platform.os === "linux" && <span className="muted small">{t("hotkeys.linuxNote")}</span>}
      <span className="muted small">{t("hotkeys.deviceLocal")}</span>

      <h3>{t("hotkeys.pttHead")}</h3>
      {settings.mode !== "ptt" ? <span className="muted small">{t("hotkeys.pttOff")}</span>
        : shell?.globalPtt ? <span className="muted small">{t("hotkeys.pttGlobal", { key: pttKey })}</span>
        : <span className="muted small">{t("hotkeys.pttLocal", { key: pttKey })}</span>}
      {settings.mode === "ptt" && status?.ptt === "invalid" && <span className="small warn">{t("hotkeys.pttInvalid", { key: pttKey })}</span>}

      <h3>{t("hotkeys.externalHead")}</h3>
      <span className="muted small">{t("hotkeys.externalText")}</span>
      {shell?.controlKey && <span className="muted small">{t("hotkeys.externalKey")}</span>}
      <ul className="hotkey-links">
        {CONTROL_ACTIONS.map((action) => {
          const link = controlLink(action, shell?.controlKey ?? null);
          return (
            <li key={action}>
              <span className="hotkey-label">{CONTROL_LABELS[action]}</span>
              <code>{link}</code>
              <button className="icon small" title={t("hotkeys.copy")} aria-label={t("hotkeys.copy")} onClick={() => copy(link)}><Icon name={copied === link ? "check" : "copy"} /></button>
            </li>
          );
        })}
      </ul>
      {executable && (
        <>
          <span className="muted small">{t("hotkeys.externalCommand")}</span>
          <div className="row">
            <code className="hotkey-command">{`"${executable}" --control=mic-toggle`}</code>
            <button className="icon small" title={t("hotkeys.copy")} aria-label={t("hotkeys.copy")} onClick={() => copy(`"${executable}" --control=mic-toggle`)}><Icon name={copied?.startsWith(`"${executable}"`) ? "check" : "copy"} /></button>
          </div>
        </>
      )}
    </div>
  );
}
