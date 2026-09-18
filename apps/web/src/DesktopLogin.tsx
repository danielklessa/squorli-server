import { BACKUP_MIN_PASSWORD } from "@squorli/protocol";
import { useState } from "react";
import * as api from "./api";
import { askConfirm } from "./dialogs";
import type { State, Store } from "./store";
import { LOCALES, localePreference, setLocalePreference, t, type LocalePreference } from "./i18n";
import { platform } from "./platform";

/**
 * Login of a client without a home server (the desktop app, docs/features/desktop.md). The directory account comes first:
 * handle + password fetch the key from the directory (code with an active authenticator), then the account's servers are
 * connected and the one viewed last is shown. Below it: go on with this device's key (servers without a directory need no
 * account). The web client's login (`LoginScreen.tsx`) signs in on the server that serves the page instead.
 */
export function DesktopLogin({ store, state }: { store: Store; state: State }) {
  const busy = state.clientLogin.busy;
  const dirHost = state.directoryUrl ? new URL(state.directoryUrl).host : null;
  const account = state.directoryAccount;
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  // Code by e-mail: offered when the directory says (after the correct password) that the account has a confirmed address.
  const [emailOffered, setEmailOffered] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const cleanHandle = handle.trim().replace(/^@/, "");

  async function signIn() {
    // Another account replaces this device's key; the same handle only fetches the key it already has.
    if (account && account.handle.toLowerCase() !== cleanHandle.toLowerCase()) {
      const ok = await askConfirm({ title: t("login.replaceKeyTitle"), text: t(account.hasBackup ? "login.replaceKeyText" : "login.replaceKeyTextNoBackup", { handle: account.handle }), confirmLabel: t("login.replace"), danger: true });
      if (!ok) return;
    }
    try {
      await store.loginDirectoryAccount(cleanHandle, password, code.trim() || undefined);
      setPassword(""); setCode(""); setNeedCode(false); setEmailOffered(false); setEmailNote(null);
    } catch (err) {
      const e = err as { code?: string | null; body?: { email?: unknown } };
      if (e.code === "totp_required") { setNeedCode(true); setEmailOffered(e.body?.email === true); }
    }
  }
  async function sendEmailCode() {
    const url = state.directoryUrl;
    if (!url) return;
    setEmailBusy(true); setEmailNote(null);
    try { setEmailNote(t("login.emailCodeSent", { to: (await api.directoryEmailCode(url, cleanHandle, password)).sentTo })); }
    catch (err) { setEmailNote(api.explainDirectoryError(err)); }
    finally { setEmailBusy(false); }
  }

  return (
    <main className="login">
      <div className="login-card">
        <header className="login-head">
          <img className="login-icon" src="/brand/squorli-icon.svg" alt="" width="72" height="72" />
          <h1>Squorli</h1>
        </header>
        {state.clientLogin.error && <p className="error">{state.clientLogin.error}</p>}

        {state.directoryUrl && (
          <div className="stack handle-box">
            <strong>{t("login.withAccount")}</strong>
            <span className="muted small">{t("desktopLogin.accountHint", { host: dirHost ?? "" })}</span>
            <div className="row">
              <span className="muted">@</span>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={t("login.handlePlaceholder")} maxLength={32} autoComplete="username" autoFocus disabled={busy} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("login.password")} autoComplete="current-password" disabled={busy}
                onKeyDown={(e) => { if (e.key === "Enter") void signIn(); }} />
              <button onClick={() => void signIn()} disabled={busy || cleanHandle.length < 3 || password.length < BACKUP_MIN_PASSWORD || (needCode && code.trim().length < 6)}>{busy ? t("login.connecting") : t("login.signIn")}</button>
            </div>
            {needCode && (
              <div className="row">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("login.codePlaceholder")} inputMode="numeric" autoComplete="one-time-code" maxLength={20} autoFocus disabled={busy}
                  onKeyDown={(e) => { if (e.key === "Enter") void signIn(); }} />
                {emailOffered && <button type="button" className="secondary" onClick={() => void sendEmailCode()} disabled={busy || emailBusy}>{emailBusy ? t("login.emailCodeSending") : t("login.emailCode")}</button>}
              </div>
            )}
            {needCode && emailNote && <span className="muted small">{emailNote}</span>}
            <span className="muted small">
              {t("login.noAccount")} <a href={state.directoryUrl} target="_blank" rel="noreferrer">{t("login.createAt", { host: dirHost ?? "" })}</a>{t("login.thenSignIn")}
            </span>
          </div>
        )}

        <div className="stack handle-box">
          <strong>{t("desktopLogin.deviceKey")}</strong>
          <code className="key">{state.identity?.publicKey ?? "…"}</code>
          {account
            ? <p>{t("login.handle")}: <strong>@{account.handle}</strong> <span className="muted small">{t("login.verifiedAt", { host: dirHost ?? "" })}</span></p>
            : <span className="muted small">{t("desktopLogin.deviceKeyHint")}</span>}
          {state.directoryError && <p className="error small">{state.directoryError}</p>}
          <div className="row">
            <button className="secondary" onClick={() => store.continueWithDeviceKey()} disabled={!state.identity || busy}>{account ? t("desktopLogin.continueAs", { handle: account.handle }) : t("desktopLogin.continueKey")}</button>
            <button className="secondary" onClick={() => void store.forgetIdentity()} disabled={busy}>{t("login.forgetIdentity")}</button>
          </div>
        </div>
      </div>
      <footer className="login-foot">
        <img src="/brand/squorli-icon-small.svg" alt="" width="18" height="18" />
        <span>{t("desktopLogin.app")}{platform.app ? ` · ${t("login.version", { v: platform.app.version })}` : ""}</span>
        <select className="lang-select" aria-label={t("common.language")} value={localePreference()} onChange={(e) => setLocalePreference(e.target.value as LocalePreference)}>
          <option value="auto">{t("lang.autoSystem")}</option>
          {LOCALES.map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
        </select>
      </footer>
    </main>
  );
}
