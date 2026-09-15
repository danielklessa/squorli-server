import { Avatar } from "./Avatar";
import type { DirectoryAccount, Me, SessionInfo } from "@squorli/protocol";
import { useCallback, useEffect, useState } from "react";
import type { ServerApi } from "./api";
import { askConfirm } from "./dialogs";
import { Icon } from "./Icon";
import { LOCALES, fmtDateTime, localePreference, setLocalePreference, t, type LocalePreference } from "./i18n";

type Tab = "profile" | "devices" | "account";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "profile", label: t("profile.tab.profile"), icon: "user" },
  { id: "devices", label: t("profile.tab.devices"), icon: "monitor-smartphone" },
  { id: "account", label: t("profile.tab.account"), icon: "key-round" },
];

const fmt = fmtDateTime;

/**
 * Profile dialog as a categorized modal (categories on the left, like settings and admin):
 * profile (display name on this server; with a directory account also the global name, both stored there with a
 * signature), devices (sessions on this server with remote sign-out, M6c), account (handle, key, link to the directory's
 * account page, sign out, discard identity).
 */
export function ProfileDialog({ api, me, directoryUrl, directoryAccount, serverDomain, onSaveDirectoryName, onClose, onLogout, onForget }: {
  api: ServerApi; me: Me; directoryUrl: string | null; directoryAccount: DirectoryAccount | null | undefined; serverDomain: string | null;
  onSaveDirectoryName: (server: string | null, displayName: string | null) => Promise<void>;
  onClose: () => void; onLogout: () => void; onForget: () => void;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const [name, setName] = useState(me.displayName ?? "");
  const [globalName, setGlobalName] = useState(directoryAccount?.displayName ?? "");
  // With a directory account: the local name is the per-server entry in the directory, empty = the global name.
  const withDirectory = !!directoryAccount && !!serverDomain;
  const [err, setErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const dirHost = directoryUrl ? new URL(directoryUrl).host : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadSessions = useCallback(async () => {
    try { setSessions(await api.getSessions()); setErr(null); } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { if (tab === "devices") void loadSessions(); }, [tab, loadSessions]);

  async function save() {
    const local = name.trim() || null;
    const global = globalName.trim() || null;
    setBusy(true);
    try {
      if (withDirectory) {
        // Store the server name only as a deviation from the global one; identical = clear the entry.
        await onSaveDirectoryName(serverDomain, local === global ? null : local);
        if (global !== (directoryAccount?.displayName ?? null)) await onSaveDirectoryName(null, global);
      }
      await api.updateMe(local ?? global);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function revoke(s: SessionInfo) {
    const ok = await askConfirm({ title: t("profile.revokeDeviceTitle"), text: t("profile.revokeDeviceText", { label: s.label ?? t("profile.thisDevice"), date: fmt(s.createdAt) }), confirmLabel: t("profile.signOut"), danger: true });
    if (!ok) return;
    setBusy(true);
    try { await api.revokeSession(s.id); await loadSessions(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function revokeOthers() {
    const ok = await askConfirm({ title: t("profile.revokeOthersTitle"), text: t("profile.revokeOthersText"), confirmLabel: t("profile.signOutAll"), danger: true });
    if (!ok) return;
    setBusy(true);
    try { await api.revokeOtherSessions(); await loadSessions(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function forget() {
    const ok = await askConfirm({ title: t("profile.forgetTitle"), text: t("profile.forgetText"), confirmLabel: t("profile.forget"), danger: true });
    if (ok) onForget();
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("profile.title")}</h2>
          <span className="spacer" />
          <button className="icon" title={t("common.close")} onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {TABS.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}><Icon name={t.icon} /> {t.label}</button>)}
          </nav>
          <div className="settings-body stack">
            {err && <p className="error">{err}</p>}

            {tab === "profile" && (
              <>
                <div className="profile-preview"><Avatar name={name || me.displayName || "?"} size="large" /><div><strong>{name || me.displayName}</strong>{me.handle && <div className="muted small">@{me.handle}</div>}</div></div>
                <h3>{t("profile.nameHere")}</h3>
                <input value={name} maxLength={32} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
                <span className="muted small">{withDirectory ? t("profile.nameHereHintDir") : t("profile.nameHereHint")}</span>
                {withDirectory && (
                  <>
                    <h3>{t("profile.nameGlobal")}</h3>
                    <input value={globalName} maxLength={32} onChange={(e) => setGlobalName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
                    <span className="muted small">{t("profile.nameGlobalHint", { host: dirHost ?? "", handle: directoryAccount?.handle ?? "" })}</span>
                  </>
                )}
                <div className="row"><button disabled={busy} onClick={() => void save()}>{t("common.save")}</button></div>
                <h3>{t("common.language")}</h3>
                <select value={localePreference()} onChange={(e) => setLocalePreference(e.target.value as LocalePreference)}>
                  <option value="auto">{t("lang.auto")}</option>
                  {LOCALES.map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
                </select>
                <span className="muted small">{t("profile.languageHint")}</span>
              </>
            )}

            {tab === "devices" && (
              <>
                <h3>{t("profile.devices")}</h3>
                <span className="muted small">{t("profile.devicesHint")}</span>
                {sessions === null ? <span className="muted">{t("common.loading")}</span> : (
                  <ul className="session-list">
                    {sessions.map((s) => (
                      <li key={s.id}>
                        <div className="stack">
                          <span><strong>{s.label ?? t("profile.unknownDevice")}</strong> {s.current && <span className="badge">{t("profile.thisDevice")}</span>}</span>
                          <span className="muted small">{t("profile.signedIn", { date: fmt(s.createdAt) })}{s.lastUsedAt ? ` · ${t("profile.lastActive", { date: fmt(s.lastUsedAt) })}` : ""}</span>
                        </div>
                        <span className="spacer" />
                        {!s.current && <button className="secondary small" disabled={busy} onClick={() => void revoke(s)}>{t("profile.signOut")}</button>}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="row">
                  <button className="secondary" disabled={busy || others === 0} onClick={() => void revokeOthers()}>{t("profile.signOutOthers")}{others ? ` (${others})` : ""}</button>
                  <button className="secondary" disabled={busy} onClick={() => void loadSessions()}>{t("common.refresh")}</button>
                </div>
              </>
            )}

            {tab === "account" && (
              <>
                <h3>{t("profile.identity")}</h3>
                {me.handle ? <p>{t("login.handle")}: <strong>@{me.handle}</strong>{dirHost ? <span className="muted small"> {t("login.verifiedAt", { host: dirHost })}</span> : null}</p> : <p className="muted small">{t("profile.noHandle")}</p>}
                <span className="muted small">{t("profile.publicKey")}</span>
                <code className="key">{me.publicKey}</code>
                {directoryUrl && (
                  <p className="muted small">
                    <a href={`${directoryUrl}/?handle=${encodeURIComponent(me.handle ?? "")}`} target="_blank" rel="noreferrer">{t("profile.manageAt", { host: dirHost ?? "" })}</a>{t("profile.manageHint")}
                  </p>
                )}
                <div className="row">
                  <button className="secondary" onClick={onLogout}>{t("profile.signOut")}</button>
                  <button className="danger" onClick={() => void forget()}>{t("profile.forgetIdentity")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
