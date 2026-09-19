import { BACKUP_MIN_PASSWORD, type InvitePreview } from "@squorli/protocol";
import { useEffect, useState } from "react";
import * as api from "./api";
import { askConfirm } from "./dialogs";
import { homeState, type State, type Store } from "./store";
import { LOCALES, locale, t } from "./i18n";
import { DOWNLOAD_URL } from "./appUpdates";
import { platform } from "./platform";
import { formatDeepLink, parseDeepLink } from "./platform/deepLink";
import { loginView, type LoginChoice } from "./loginView";
import { PasswordInput } from "./PasswordInput";

/** Invite code from /invite/<code> or ?invite=<code>. */
export function inviteFromUrl(): string | null {
  const m = window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{6,32})/);
  if (m) return m[1]!;
  return new URLSearchParams(window.location.search).get("invite");
}

/**
 * Account sign-in and local access are separate views; registration belongs to the directory.
 * If the device key already has a handle, continuing with that account comes first.
 */
export function LoginScreen({ store, state }: { store: Store; state: State }) {
  // Only a client with a home server shows this login (App.tsx); one without has DesktopLogin.tsx.
  const home = homeState(state)!;
  const [invite, setInvite] = useState(() => inviteFromUrl() ?? "");
  const [needInvite, setNeedInvite] = useState(() => !!inviteFromUrl());
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const busy = home.connection === "logging-in" || home.connection === "connecting";
  const dirHost = state.directoryUrl ? new URL(state.directoryUrl).host : null;

  // Existing account: create a password backup when it is still missing.
  const [backupPw, setBackupPw] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  // Account: handle + password, plus a code when the authenticator is active (M6c)
  const [accHandle, setAccHandle] = useState("");
  const [accPw, setAccPw] = useState("");
  const [accCode, setAccCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  // Code by e-mail: offered when the directory says (after the correct password) that the account has a confirmed address.
  const [emailOffered, setEmailOffered] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [choice, setChoice] = useState<LoginChoice | null>(null);

  // Account required (admin): a browser key without a handle is not offered at all (no box, no toggle);
  // if it has a verified handle it is an account and may sign in as before.
  const { mode, accountRequired, deviceAllowed, showDevice, showAccount } =
    loginView(!!state.directoryUrl, !!state.directoryAccount, home.requireAccount, choice);

  useEffect(() => {
    const code = invite.trim();
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(code)) { setPreview(null); return; }
    let alive = true;
    store.home!.api.getInvitePreview(code).then((p) => { if (alive) setPreview(p); }).catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [invite]);

  function afterLogin() {
    if (window.location.pathname.startsWith("/invite/")) window.history.replaceState(null, "", "/");
  }
  function onLoginError(err: unknown) {
    const code = (err as { code?: string | null }).code;
    if (code === "invite_required" || code === "invite_invalid") setNeedInvite(true);
    if (code === "totp_required") { setNeedCode(true); setEmailOffered((err as { body?: { email?: unknown } }).body?.email === true); }
  }
  async function sendEmailCode() {
    const url = state.directoryUrl;
    if (!url) return;
    setEmailBusy(true); setEmailNote(null);
    try {
      const r = await api.directoryEmailCode(url, accHandle.trim().replace(/^@/, ""), accPw);
      setEmailNote(t("login.emailCodeSent", { to: r.sentTo }));
    } catch (err) { setEmailNote(api.explainDirectoryError(err)); }
    finally { setEmailBusy(false); }
  }

  async function go() {
    try { await store.login(invite.trim() || undefined); afterLogin(); }
    catch (err) { onLoginError(err); }
  }

  async function goAccount() {
    if (state.directoryAccount) {
      const ok = await askConfirm({
        title: t("login.replaceKeyTitle"),
        text: t(state.directoryAccount.hasBackup ? "login.replaceKeyText" : "login.replaceKeyTextNoBackup", { handle: state.directoryAccount.handle }),
        confirmLabel: t("login.replace"), danger: true,
      });
      if (!ok) return;
    }
    try {
      await store.loginWithHandle(accHandle.trim().replace(/^@/, ""), accPw, invite.trim() || undefined, accCode.trim() || undefined);
      setAccPw(""); setAccCode(""); setNeedCode(false); setEmailOffered(false); setEmailNote(null);
      afterLogin();
    } catch (err) { onLoginError(err); }
  }

  async function backup() {
    setBackupBusy(true);
    try { if (await store.createBackup(backupPw)) setBackupPw(""); } finally { setBackupBusy(false); }
  }

  // "Open in the desktop app": a plain link the user clicks (never a redirect: without the app nothing would happen), always
  // next to the download. Offered where the app exists (Windows, Linux). The link goes through the parser, so it is only
  // shown when the app will accept it.
  const appLink = (() => {
    if (platform.kind !== "web" || (platform.os !== "windows" && platform.os !== "linux")) return null;
    const host = home.serverDomain ?? window.location.host;
    const code = invite.trim();
    const raw = /^[A-Za-z0-9_-]{6,32}$/.test(code) ? `squorli://invite/${host}/${code}` : `squorli://server/${host}`;
    const link = parseDeepLink(raw);
    return link ? formatDeepLink(link) : null;
  })();

  const accountBox = showAccount && (
    <div className="stack handle-box">
      <h2>{t("login.withAccount")}</h2>
      <span className="muted small">{t("login.withAccountHint", { host: dirHost ?? "" })}</span>
      <div className="login-fields">
        <label className="stack"><span>{t("login.username")}</span>
          <span className="login-handle-field">
            <span className="muted" aria-hidden="true">@</span>
            <input value={accHandle} onChange={(e) => setAccHandle(e.target.value.trimStart().replace(/^@+/, ""))} placeholder={t("login.handleExample")} maxLength={33} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} aria-describedby="login-handle-hint" />
          </span>
          <small id="login-handle-hint" className="muted">{t("login.usernameHint")}</small>
        </label>
        <label className="stack"><span>{t("login.password")}</span>
          <PasswordInput value={accPw} onChange={(e) => setAccPw(e.target.value)} autoComplete="current-password" disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter") void goAccount(); }} />
        </label>
      </div>
      {needCode && (
        <div className="login-fields">
          <label className="stack"><span>{t("login.codePlaceholder")}</span>
          <input value={accCode} onChange={(e) => setAccCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} autoFocus disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") void goAccount(); }} />
          </label>
          {emailOffered && <button type="button" className="secondary" onClick={() => void sendEmailCode()} disabled={busy || emailBusy}>{emailBusy ? t("login.emailCodeSending") : t("login.emailCode")}</button>}
        </div>
      )}
      {needCode && emailNote && <span className="muted small">{emailNote}</span>}
      <button className="login-primary" onClick={() => void goAccount()} disabled={busy || accHandle.trim().length < 3 || accPw.length < BACKUP_MIN_PASSWORD || (needCode && accCode.trim().length < 6)}>{busy ? t("login.connecting") : t("login.signIn")}</button>
      <p className="muted small"><a href={`${state.directoryUrl ?? ""}/?handle=${encodeURIComponent(accHandle.trim().replace(/^@/, ""))}`} target="_blank" rel="noreferrer">{t("login.manageAccount")}</a> {t("login.manageAccountHint")}</p>
    </div>
  );

  const deviceBox = showDevice && (
    <div className="stack handle-box">
      <h2>{t(state.directoryAccount ? "login.savedAccount" : "login.continueLocal")}</h2>
      <p className="muted small">{t(state.directoryAccount ? "login.savedHint" : "login.localHint")}</p>
      {state.directoryUrl ? (
        state.directoryAccount ? (
          <>
            <p>{t("login.handle")}: <strong>@{state.directoryAccount.handle}</strong> <span className="muted small">{t("login.verifiedAt", { host: dirHost ?? "" })}</span></p>
            {state.directoryAccount.hasBackup ? (
              <span className="muted small">{t("login.backupPresent", { handle: state.directoryAccount.handle })}</span>
            ) : (
              <>
                <label className="stack"><span>{t("login.setPasswordFor", { handle: state.directoryAccount.handle })}</span>
                  <PasswordInput value={backupPw} onChange={(e) => setBackupPw(e.target.value)} placeholder={t("login.passwordMin", { n: BACKUP_MIN_PASSWORD })} autoComplete="new-password" disabled={backupBusy}
                    onKeyDown={(e) => { if (e.key === "Enter") void backup(); }} />
                </label>
                  <button className="secondary" onClick={() => void backup()} disabled={backupBusy || backupPw.length < BACKUP_MIN_PASSWORD}>{backupBusy ? t("login.saving") : t("login.setPassword")}</button>
                <span className="muted small">{t("login.backupHint")}</span>
              </>
            )}
          </>
        ) : (
          state.directoryAccount === undefined ? <span className="muted small">{t("login.queryingDirectory")}</span> : null
        )
      ) : (
        <span className="muted small">{t("login.noDirectory")}</span>
      )}
      <details className="login-details">
        <summary>{t("login.deviceKey")}</summary>
        <code className="key">{state.identity?.publicKey ?? "…"}</code>
        <button type="button" className="secondary" onClick={() => void store.forgetIdentity()} disabled={busy}>{t("login.forgetIdentity")}</button>
      </details>
      <button className="login-primary" onClick={() => void go()} disabled={!state.identity || busy}>{busy ? t("login.connecting") : t(state.directoryAccount ? "login.signInConnect" : "login.continueLocal")}</button>
      {state.directoryError && <p className="error small">{state.directoryError}</p>}
    </div>
  );

  return (
    <main className="login server-login">
      <div className="login-card">
        <header className="login-head">
          <img className="login-icon" src={home.iconUrl ?? "/brand/squorli-icon.svg"} alt="" width="72" height="72" />
          <h1>{home.serverName ?? "Squorli"}</h1>
        </header>
        {preview && (
          <p className="invite-preview">
            {t("login.inviteTo")} <strong>{preview.serverName}</strong> · {t("login.memberCount", { n: preview.memberCount })}
            {!preview.valid && <span className="error"> · {t("login.inviteInvalid")}</span>}
          </p>
        )}
        {home.removed && (
          <p className="error">
            {home.removed.reason === "banned" ? t("login.bannedShort") : t("login.removedShort")}
            {home.removed.message ? `: ${home.removed.message}` : "."}
          </p>
        )}
        {home.error && <p className="error">{home.error}</p>}

        {state.directoryUrl && <nav className="login-choices" aria-label={t("login.accessChoice")}>
          <button type="button" className="secondary" aria-pressed={showAccount} disabled={busy || backupBusy} onClick={() => setChoice("account")}>{t("login.withAccount")}</button>
          {deviceAllowed && <button type="button" className="secondary" aria-pressed={mode === "device"} disabled={busy || backupBusy} onClick={() => setChoice("device")}>{t(state.directoryAccount ? "login.savedAccount" : "login.continueLocal")}</button>}
        </nav>}
        {state.directoryUrl && <div className="login-create-row">
          <a href={state.directoryUrl} target="_blank" rel="noreferrer">{t("login.createAccount")}</a>
          <p className="muted small">{t("login.createDirectoryHint", { host: dirHost ?? "" })}</p>
        </div>}
        {(needInvite || invite) && (
          <label className="stack">
            <span>{t("login.inviteCode")}</span>
            <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t("login.invitePlaceholder")} autoFocus />
          </label>
        )}
        {accountBox}{deviceBox}
        {accountRequired && !deviceAllowed && <p className="muted small">{t("login.accountRequired")}</p>}
        {!showDevice && state.directoryError && <p className="error small">{state.directoryError}</p>}

        <div className="row">
          {!needInvite && !invite && <button className="secondary" onClick={() => setNeedInvite(true)}>{t("login.haveInvite")}</button>}
        </div>
      </div>
      {appLink && <p className="login-app muted small">{t("login.appHint")} <a href={appLink}>{t("login.openInApp")}</a> · <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">{t("login.getApp")}</a></p>}
      <footer className="login-foot">
        <img src="/brand/squorli-icon-small.svg" alt="" width="18" height="18" />
        <span>{t("login.poweredBy")}{home.serverVersion ? ` · ${t("login.version", { v: home.serverVersion })}` : ""}</span>
        <div className="login-languages" role="group" aria-label={t("common.language")}>
          {LOCALES.map((l) => <button key={l} type="button" className="secondary" lang={l} aria-pressed={locale === l}
            onClick={() => { if (l !== locale) void store.setLocale(l); }}>{t(`lang.${l}`)}</button>)}
        </div>
      </footer>
    </main>
  );
}
