import { BACKUP_MIN_PASSWORD, type InvitePreview } from "@squorli/protocol";
import { useEffect, useState } from "react";
import { getInvitePreview } from "./api";
import { askConfirm } from "./dialogs";
import type { State, Store } from "./store";

/** Einladungscode aus /invite/<code> oder ?invite=<code>. */
export function inviteFromUrl(): string | null {
  const m = window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{6,32})/);
  if (m) return m[1]!;
  return new URLSearchParams(window.location.search).get("invite");
}

/**
 * Login: mit Verzeichnis (M6) zwei Wege. "Mit Konto anmelden" holt den Schluessel per Handle + Passwort vom Verzeichnis
 * (M6b) und ersetzt den Geraeteschluessel; "Schluessel dieses Browsers" ist der bisherige Weg (Handle registrieren,
 * Passwort-Backup anlegen). Hat der Geraeteschluessel schon ein Handle, steht er vorn.
 */
export function LoginScreen({ store, state }: { store: Store; state: State }) {
  const [invite, setInvite] = useState(() => inviteFromUrl() ?? "");
  const [needInvite, setNeedInvite] = useState(() => !!inviteFromUrl());
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const busy = state.connection === "logging-in" || state.connection === "connecting";
  const dirHost = state.directoryUrl ? new URL(state.directoryUrl).host : null;

  // Geraeteschluessel: Handle registrieren, Passwort-Backup anlegen
  const [handle, setHandle] = useState("");
  const [registering, setRegistering] = useState(false);
  const [backupPw, setBackupPw] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  // Konto: Handle + Passwort, bei aktivem Authenticator (M6c) zusaetzlich ein Code
  const [accHandle, setAccHandle] = useState("");
  const [accPw, setAccPw] = useState("");
  const [accCode, setAccCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [showOther, setShowOther] = useState(false);

  // Nur mit Konto (Verwaltung): der reine Browser-Schluessel darf sich erst anmelden, wenn er ein Handle hat.
  const accountRequired = state.requireAccount && !!state.directoryUrl;
  const deviceAllowed = !accountRequired || !!state.directoryAccount;
  const deviceFirst = !state.directoryUrl || !!state.directoryAccount;
  const showDevice = deviceFirst || showOther;
  const showAccount = !!state.directoryUrl && (!deviceFirst || showOther);

  useEffect(() => {
    const code = invite.trim();
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(code)) { setPreview(null); return; }
    let alive = true;
    getInvitePreview(code).then((p) => { if (alive) setPreview(p); }).catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [invite]);

  function afterLogin() {
    if (window.location.pathname.startsWith("/invite/")) window.history.replaceState(null, "", "/");
  }
  function onLoginError(err: unknown) {
    const code = (err as { code?: string | null }).code;
    if (code === "invite_required" || code === "invite_invalid") setNeedInvite(true);
    if (code === "totp_required") setNeedCode(true);
  }

  async function go() {
    try { await store.login(invite.trim() || undefined); afterLogin(); }
    catch (err) { onLoginError(err); }
  }

  async function goAccount() {
    if (state.directoryAccount) {
      const ok = await askConfirm({
        title: "Schlüssel ersetzen?",
        text: `In diesem Browser ist bereits @${state.directoryAccount.handle} eingerichtet. Die Anmeldung mit einem Konto ersetzt diesen Schlüssel${state.directoryAccount.hasBackup ? "." : ", und er hat noch kein Passwort-Backup. Ohne Backup ist er danach weg."}`,
        confirmLabel: "Ersetzen", danger: true,
      });
      if (!ok) return;
    }
    try {
      await store.loginWithHandle(accHandle.trim().replace(/^@/, ""), accPw, invite.trim() || undefined, accCode.trim() || undefined);
      setAccPw(""); setAccCode(""); setNeedCode(false);
      afterLogin();
    } catch (err) { onLoginError(err); }
  }

  async function register() {
    setRegistering(true);
    try { await store.registerHandle(handle.trim().replace(/^@/, "")); } finally { setRegistering(false); }
  }
  async function backup() {
    setBackupBusy(true);
    try { if (await store.createBackup(backupPw)) setBackupPw(""); } finally { setBackupBusy(false); }
  }

  const accountBox = showAccount && (
    <div className="stack handle-box">
      <strong>Mit Konto anmelden</strong>
      <span className="muted small">Handle und Passwort vom Verzeichnis {dirHost}. Der Schlüssel wird auf dieses Gerät geholt.</span>
      <div className="row">
        <span className="muted">@</span>
        <input value={accHandle} onChange={(e) => setAccHandle(e.target.value)} placeholder="handle" maxLength={32} autoComplete="username" disabled={busy} />
        <input type="password" value={accPw} onChange={(e) => setAccPw(e.target.value)} placeholder="Passwort" autoComplete="current-password" disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter") void goAccount(); }} />
        <button onClick={() => void goAccount()} disabled={busy || accHandle.trim().length < 3 || accPw.length < BACKUP_MIN_PASSWORD || (needCode && accCode.trim().length < 6)}>{busy ? "Verbinde …" : "Anmelden"}</button>
      </div>
      {needCode && (
        <div className="row">
          <input value={accCode} onChange={(e) => setAccCode(e.target.value)} placeholder="Code aus der Authenticator-App oder Wiederherstellungscode" inputMode="numeric" autoComplete="one-time-code" maxLength={20} autoFocus disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") void goAccount(); }} />
        </div>
      )}
      <span className="muted small">
        Noch kein Konto? <a href={state.directoryUrl ?? "#"} target="_blank" rel="noreferrer">Auf {dirHost} anlegen</a>, dann hier anmelden.
        {" · "}<a href={`${state.directoryUrl ?? ""}/?handle=${encodeURIComponent(accHandle.trim().replace(/^@/, ""))}`} target="_blank" rel="noreferrer">Konto verwalten</a> (Passwort, Authenticator, Wiederherstellungscodes)
      </span>
    </div>
  );

  const deviceBox = showDevice && (
    <div className="stack handle-box">
      <strong>Schlüssel dieses Browsers</strong>
      <code className="key">{state.identity?.publicKey ?? "…"}</code>
      {state.directoryUrl ? (
        state.directoryAccount ? (
          <>
            <p>Handle: <strong>@{state.directoryAccount.handle}</strong> <span className="muted small">(bei {dirHost} verifiziert)</span></p>
            {state.directoryAccount.hasBackup ? (
              <span className="muted small">Passwort-Backup vorhanden: auf anderen Geräten „Mit Konto anmelden“ mit @{state.directoryAccount.handle} und Passwort.</span>
            ) : (
              <>
                <span>Passwort festlegen, um dich auf anderen Geräten mit @{state.directoryAccount.handle} anzumelden</span>
                <div className="row">
                  <input type="password" value={backupPw} onChange={(e) => setBackupPw(e.target.value)} placeholder={`Passwort (mindestens ${BACKUP_MIN_PASSWORD} Zeichen)`} autoComplete="new-password" disabled={backupBusy}
                    onKeyDown={(e) => { if (e.key === "Enter") void backup(); }} />
                  <button className="secondary" onClick={() => void backup()} disabled={backupBusy || backupPw.length < BACKUP_MIN_PASSWORD}>{backupBusy ? "Sichere …" : "Passwort festlegen"}</button>
                </div>
                <span className="muted small">Der Schlüssel wird mit dem Passwort verschlüsselt beim Verzeichnis abgelegt; das Verzeichnis kennt das Passwort nicht. Ohne Backup ist das Konto weg, wenn dieser Browser-Speicher gelöscht wird.</span>
              </>
            )}
          </>
        ) : state.directoryAccount === null ? (
          <>
            <span>Handle wählen (einmalig, serverübergreifend)</span>
            <div className="row">
              <span className="muted">@</span>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="z. B. daniel" maxLength={32}
                onKeyDown={(e) => { if (e.key === "Enter") void register(); }} disabled={registering} />
              <button className="secondary" onClick={() => void register()} disabled={registering || handle.trim().length < 3}>{registering ? "Registriere …" : "Handle registrieren"}</button>
            </div>
            <span className="muted small">3-32 Zeichen: Kleinbuchstaben, Ziffern, Punkt, Unterstrich. Danach kannst du ein Passwort festlegen, um dich auf anderen Geräten anzumelden. Ohne Handle geht es auch.</span>
          </>
        ) : (
          <span className="muted small">Verzeichnis wird abgefragt …</span>
        )
      ) : (
        <span className="muted small">Dieser Server nutzt kein Verzeichnis: kein Handle, Anmeldung nur mit diesem Schlüssel. Wer diesen Browser-Speicher verliert, verliert dieses Konto.</span>
      )}
      {accountRequired && !state.directoryAccount && state.directoryAccount !== undefined && (
        <span className="small">Dieser Server verlangt ein Konto: Handle registrieren oder oben mit einem Konto anmelden.</span>
      )}
      {state.directoryError && <p className="error small">{state.directoryError}</p>}
    </div>
  );

  return (
    <main className="login">
      <div className="login-card">
        <header className="login-head">
          <img className="login-icon" src={state.iconUrl ?? "/brand/squorli-icon.svg"} alt="" width="72" height="72" />
          <h1>{state.serverName ?? "Squorli"}</h1>
        </header>
        {preview && (
          <p className="invite-preview">
            Einladung zu <strong>{preview.serverName}</strong> · {preview.memberCount} Mitglieder
            {!preview.valid && <span className="error"> · Einladung ungültig oder abgelaufen</span>}
          </p>
        )}
        {state.removed && (
          <p className="error">
            {state.removed.reason === "banned" ? "Du wurdest gebannt" : "Du wurdest vom Server entfernt"}
            {state.removed.message ? `: ${state.removed.message}` : "."}
          </p>
        )}
        {state.error && <p className="error">{state.error}</p>}

        {deviceFirst ? <>{deviceBox}{accountBox}</> : <>{accountBox}{deviceBox}</>}
        {state.directoryUrl && (
          <button className="secondary small" onClick={() => setShowOther(!showOther)}>
            {showOther ? "Weniger anzeigen" : deviceFirst ? "Mit einem anderen Konto anmelden" : accountRequired ? "Schlüssel dieses Browsers verwenden" : "Ohne Konto: Schlüssel dieses Browsers verwenden"}
          </button>
        )}

        {(needInvite || invite) && (
          <label className="stack">
            <span>Einladungscode</span>
            <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="z. B. aus einem Link /invite/…" autoFocus />
          </label>
        )}

        <div className="row">
          {showDevice && <button onClick={() => void go()} disabled={!state.identity || busy || !deviceAllowed}>{busy ? "Verbinde …" : "Anmelden und verbinden"}</button>}
          {!needInvite && !invite && <button className="secondary" onClick={() => setNeedInvite(true)}>Ich habe eine Einladung</button>}
          {showDevice && <button className="secondary" onClick={() => void store.forgetIdentity()} disabled={busy}>Identität verwerfen</button>}
        </div>
      </div>
      <footer className="login-foot">
        <img src="/brand/squorli-icon-small.svg" alt="" width="18" height="18" />
        <span>Betrieben mit Squorli{state.serverVersion ? ` · Version ${state.serverVersion}` : ""}</span>
      </footer>
    </main>
  );
}
