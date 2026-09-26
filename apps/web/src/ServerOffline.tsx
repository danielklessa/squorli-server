import { rememberedHomeName } from "./branding";
import { t } from "./i18n";
import { RetryCountdown } from "./RetryCountdown";
import type { ServerConnState } from "./serverConnection";

/**
 * The own server does not answer while this device has a session there (docs/features/offline.md): shown by App.tsx in
 * place of the login. The connection tries again by itself (`ServerConnection.retryLater`); "Erneut versuchen" runs the
 * scheduled try now, "Abmelden" drops the session and leads to the login after all.
 */
export function ServerOffline({ s, onRetry, onLogout }: { s: ServerConnState; onRetry: () => void; onLogout: () => void }) {
  // The name comes from /api/health, which did not answer either: the name seen last, else the address.
  const name = s.serverName ?? rememberedHomeName() ?? s.host;
  const checking = s.waiting === "checking";
  return (
    <div className="app-starting server-offline" role="status">
      <div className="app-starting-card">
        <img src="/brand/squorli-icon.svg" alt="" />
        <h2>{checking ? t("offline.checking", { name }) : t("offline.title", { name })}</h2>
        {!checking && <p>{t("offline.text")}</p>}
        {!checking && <RetryCountdown at={s.retryAt} />}
        {!checking && (
          <div className="row">
            <button onClick={onRetry}>{t("common.retry")}</button>
            <button className="secondary" onClick={onLogout}>{t("offline.logout")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
