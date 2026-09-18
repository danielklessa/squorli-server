import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";
import type { ScreenPick, ScreenSource } from "./platform";

/**
 * Which screen or window to share. Only the desktop app shows it: a browser brings its own picker, Electron has none, so
 * the shell lists the sources and asks the client (`platform.screen.setPicker`, App.tsx). Audio is a choice and off by
 * default: for a window it is what that window's application plays, for a screen what the computer plays (`source.audio`
 * says whether the shell can deliver it; Windows only).
 */
export function ScreenPicker({ sources, onPick, onCancel }: { sources: ScreenSource[]; onPick: (pick: ScreenPick) => void; onCancel: () => void }) {
  const screens = sources.filter((s) => s.kind === "screen");
  const windows = sources.filter((s) => s.kind === "window");
  const [selected, setSelected] = useState<string | null>(screens.length === 1 ? screens[0]!.id : null);
  const [audio, setAudio] = useState(false);
  const chosen = sources.find((s) => s.id === selected) ?? null;
  const anyAudio = sources.some((s) => s.audio);
  const pick = (id = selected) => { const s = sources.find((x) => x.id === id); if (s) onPick({ sourceId: s.id, audio: s.audio && audio }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } if (e.key === "Enter" && selected) pick(); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }); // deliberately without dependencies: always reads the current state

  const group = (title: string, list: ScreenSource[]) => list.length > 0 && (
    <>
      <h3>{title}</h3>
      <ul className="screen-grid">
        {list.map((s) => (
          <li key={s.id}>
            <button className={`screen-option ${selected === s.id ? "active" : ""}`} title={s.name} onClick={() => setSelected(s.id)} onDoubleClick={() => pick(s.id)}>
              <span className="screen-thumb">{s.thumbnail ? <img src={s.thumbnail} alt="" /> : <Icon name={s.kind === "screen" ? "monitor" : "app-window"} />}</span>
              <span className="screen-name">{s.icon && <img src={s.icon} alt="" width="16" height="16" />}{s.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={onCancel}>
      <div className="modal dialog screen-picker" role="dialog" aria-modal="true" aria-labelledby="screen-picker-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="screen-picker-title">{t("screenPick.title")}</h2>
        <div className="screen-picker-body">
          {sources.length === 0 && <p className="muted">{t("screenPick.none")}</p>}
          {group(t("screenPick.screens"), screens)}
          {group(t("screenPick.windows"), windows)}
        </div>
        {anyAudio && (
          <label className="check"><input type="checkbox" checked={audio && (chosen?.audio ?? true)} disabled={chosen !== null && !chosen.audio} onChange={(e) => setAudio(e.target.checked)} /> {chosen?.kind === "window" ? t("screenPick.audioWindow") : t("screenPick.audio")}</label>
        )}
        {anyAudio && <span className="muted small">{chosen && !chosen.audio ? t("screenPick.audioNone") : chosen?.kind === "window" ? t("screenPick.audioWindowHint") : t("screenPick.audioHint")}</span>}
        <div className="dialog-actions">
          <button className="secondary" onClick={onCancel}>{t("common.cancel")}</button>
          <button disabled={!selected} onClick={() => pick()}>{t("screenPick.share")}</button>
        </div>
      </div>
    </div>
  );
}
