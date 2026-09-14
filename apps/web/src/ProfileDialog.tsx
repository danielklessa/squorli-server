import type { Me, SessionInfo } from "@squorli/protocol";
import { useCallback, useEffect, useState } from "react";
import { getSessions, revokeOtherSessions, revokeSession, updateMe } from "./api";
import { askConfirm } from "./dialogs";
import { Icon } from "./Icon";

type Tab = "profile" | "devices" | "account";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "profile", label: "Profil", icon: "user" },
  { id: "devices", label: "Geräte", icon: "monitor-smartphone" },
  { id: "account", label: "Konto", icon: "key-round" },
];

const fmt = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Profil-Dialog als kategorisiertes Modal (Kategorien links, wie Einstellungen und Verwaltung):
 * Profil (Anzeigename), Geraete (Sitzungen auf diesem Server mit Fernabmeldung, M6c), Konto (Handle, Schluessel,
 * Link zur Kontoseite des Verzeichnisses, Abmelden, Identitaet verwerfen).
 */
export function ProfileDialog({ me, directoryUrl, onClose, onLogout, onForget }: { me: Me; directoryUrl: string | null; onClose: () => void; onLogout: () => void; onForget: () => void }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [name, setName] = useState(me.displayName ?? "");
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
    try { setSessions(await getSessions()); setErr(null); } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { if (tab === "devices") void loadSessions(); }, [tab, loadSessions]);

  async function save() {
    try { await updateMe(name.trim() || null); onClose(); } catch (e) { setErr(String(e)); }
  }
  async function revoke(s: SessionInfo) {
    const ok = await askConfirm({ title: "Gerät abmelden?", text: `${s.label ?? "Dieses Gerät"} (angemeldet am ${fmt(s.createdAt)}) wird sofort abgemeldet.`, confirmLabel: "Abmelden", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await revokeSession(s.id); await loadSessions(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function revokeOthers() {
    const ok = await askConfirm({ title: "Alle anderen Geräte abmelden?", text: "Alle Sitzungen außer dieser werden sofort beendet.", confirmLabel: "Alle abmelden", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await revokeOtherSessions(); await loadSessions(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function forget() {
    const ok = await askConfirm({ title: "Identität verwerfen?", text: "Der Schlüssel wird aus diesem Browser gelöscht. Ohne Passwort-Backup beim Verzeichnis ist das Konto danach nicht wiederherstellbar.", confirmLabel: "Verwerfen", danger: true });
    if (ok) onForget();
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Profil</h2>
          <span className="spacer" />
          <button className="icon" title="Schließen" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {TABS.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}><Icon name={t.icon} /> {t.label}</button>)}
          </nav>
          <div className="settings-body stack">
            {err && <p className="error">{err}</p>}

            {tab === "profile" && (
              <>
                <h3>Anzeigename auf diesem Server</h3>
                <input value={name} maxLength={32} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
                <span className="muted small">Leer = Handle bzw. Kurzform des Schlüssels.</span>
                <div className="row"><button onClick={() => void save()}>Speichern</button></div>
              </>
            )}

            {tab === "devices" && (
              <>
                <h3>Angemeldete Geräte</h3>
                <span className="muted small">Sitzungen deines Kontos auf diesem Server. Ein abgemeldetes Gerät fällt sofort auf den Login zurück.</span>
                {sessions === null ? <span className="muted">Lade …</span> : (
                  <ul className="session-list">
                    {sessions.map((s) => (
                      <li key={s.id}>
                        <div className="stack">
                          <span><strong>{s.label ?? "Unbekanntes Gerät"}</strong> {s.current && <span className="badge">Dieses Gerät</span>}</span>
                          <span className="muted small">angemeldet {fmt(s.createdAt)}{s.lastUsedAt ? ` · zuletzt aktiv ${fmt(s.lastUsedAt)}` : ""}</span>
                        </div>
                        <span className="spacer" />
                        {!s.current && <button className="secondary small" disabled={busy} onClick={() => void revoke(s)}>Abmelden</button>}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="row">
                  <button className="secondary" disabled={busy || others === 0} onClick={() => void revokeOthers()}>Alle anderen Geräte abmelden{others ? ` (${others})` : ""}</button>
                  <button className="secondary" disabled={busy} onClick={() => void loadSessions()}>Aktualisieren</button>
                </div>
              </>
            )}

            {tab === "account" && (
              <>
                <h3>Identität</h3>
                {me.handle ? <p>Handle: <strong>@{me.handle}</strong>{dirHost ? <span className="muted small"> (bei {dirHost} verifiziert)</span> : null}</p> : <p className="muted small">Kein Handle beim Verzeichnis.</p>}
                <span className="muted small">Öffentlicher Schlüssel:</span>
                <code className="key">{me.publicKey}</code>
                {directoryUrl && (
                  <p className="muted small">
                    <a href={`${directoryUrl}/?handle=${encodeURIComponent(me.handle ?? "")}`} target="_blank" rel="noreferrer">Konto verwalten auf {dirHost}</a>: Passwort ändern, Authenticator einrichten, Wiederherstellungscodes, Schlüsselabrufe.
                  </p>
                )}
                <div className="row">
                  <button className="secondary" onClick={onLogout}>Abmelden</button>
                  <button className="danger" onClick={() => void forget()}>Identität verwerfen</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
