import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { retryLocked, type OtherServer } from "./otherServers";
import { RetryCountdown, useNow } from "./RetryCountdown";
import type { ServerConnState } from "./serverConnection";
import { initials } from "./ServerRail";

/**
 * The main area for a server of the rail that does not answer (docs/features/offline.md; user's wish of 26 September 2026):
 * the notice centred both ways, the countdown to the next automatic try above "Erneut versuchen" (locked after every try
 * that starts, by hand or by itself: 5 s at least, and until that try is through), below it up to five other servers that can be reached right now, each a
 * row with the server's icon left of its name, a button that switches to it. The rail stays, so any server can be picked.
 * `checking` = the first contact is still under way (the stored session or the health request): only "Verbinde mit …".
 */
export function ServerUnreachable({ s, name, checking, others, onRetry, onOpen }: { s: ServerConnState; name: string; checking: boolean; others: OtherServer[]; onRetry: () => void; onOpen: (key: string) => void }) {
  // When a try starts (the countdown reaches its end, or the button was pressed), the button rests for a while.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const lastRetryAt = useRef(s.retryAt);
  useEffect(() => {
    if (lastRetryAt.current !== null && s.retryAt === null) setStartedAt(Date.now());
    lastRetryAt.current = s.retryAt;
  }, [s.retryAt]);
  const now = useNow(startedAt !== null);
  // A try is under way while nothing is scheduled (`retryAt` null), the server has not answered and the plan is not used up.
  const locked = retryLocked(startedAt, now, s.retryAt === null && !s.retryPaused);
  if (checking) {
    return (
      <section className="chat empty server-status server-unreachable">
        <div className="unreachable-card"><h2>{t("offline.checking", { name })}</h2></div>
      </section>
    );
  }
  return (
    <section className="chat empty server-status server-unreachable">
      <div className="unreachable-card">
        <h2>{t("offline.title", { name })}</h2>
        <p className="muted">{t("status.offline", { name })}</p>
        {s.retryPaused ? <p className="muted retry-countdown">{t("status.autoStopped")}</p> : <RetryCountdown at={s.retryAt} />}
        <button className="login-primary" disabled={locked} onClick={() => { setStartedAt(Date.now()); onRetry(); }}>{t("common.retry")}</button>
        {others.length > 0 && (
          <div className="unreachable-others">
            <span className="muted small">{t("status.otherServers")}</span>
            <ul>
              {others.map((o) => (
                <li key={o.key}>
                  <button className="secondary other-server" onClick={() => onOpen(o.key)}>
                    <span className="other-server-icon">{o.iconUrl ? <img src={o.iconUrl} alt="" /> : <span className="rail-initials">{initials(o.name)}</span>}</span>
                    <span className="other-server-name">{o.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
