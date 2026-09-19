import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { ContextMenu, type MenuAnchor } from "./ContextMenu";
import { Icon } from "./Icon";
import { t } from "./i18n";

/**
 * Mini profile, opened by clicking your own name in the dock: who you are here (name, handle) and the one thing that can be
 * changed on the spot, your display name on the server shown. Everything else lives in the settings (gear, or the button here).
 */
export function MiniProfile({ anchor, displayName, avatarUrl, serverName, handle, storedName, withDirectory, onSave, onOpenSettings, onClose }: {
  anchor: MenuAnchor;
  /** Your name as the server shows it right now. */
  displayName: string;
  avatarUrl: string | null;
  /** The name set for this server (null = none, the global name or the handle applies). */
  storedName: string | null;
  serverName: string | null; handle: string | null;
  /** With a directory account an empty name falls back to the global one, otherwise to the handle or key. */
  withDirectory: boolean;
  onSave: (displayName: string | null) => Promise<void>;
  onOpenSettings: () => void; onClose: () => void;
}) {
  const [name, setName] = useState(storedName ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // After the menu's own focus handling (layout effect): the name field is what this popup is for.
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  async function save() {
    setBusy(true);
    try { await onSave(name.trim() || null); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <ContextMenu anchor={anchor} label={t("mini.title")} onClose={onClose}>
      <div className="context-identity">
        <Avatar name={name.trim() || displayName} src={avatarUrl} size="medium" />
        <div><strong>{name.trim() || displayName}</strong><span className="muted small">{handle ? `@${handle}` : t("profile.noHandle")}</span></div>
      </div>
      <div className="mini-profile stack">
        <label className="stack">
          <span className="small">{serverName ? t("mini.nameOn", { server: serverName }) : t("profile.nameHere")}</span>
          {/* The menu steers focus with the arrow keys, Home and End; inside the field they belong to the text cursor. */}
          <input ref={input} value={name} maxLength={32} disabled={busy} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation(); }} />
        </label>
        <span className="muted small">{withDirectory ? t("mini.nameHintDir") : t("profile.nameHereHint")}</span>
        {err && <p className="error small">{err}</p>}
        <div className="row">
          <button className="small" disabled={busy} onClick={() => void save()}>{t("common.save")}</button>
          <button className="secondary small" onClick={() => { onClose(); onOpenSettings(); }}><Icon name="settings" /> {t("mini.allSettings")}</button>
        </div>
      </div>
    </ContextMenu>
  );
}
