import { useEffect, useState } from "react";
import { t } from "./i18n";
import { secondsUntil } from "./otherServers";

/** The current time, refreshed every `everyMs` while `active` (a countdown, a button locked for a while). */
export function useNow(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

/**
 * "Nächster automatischer Versuch in n s" above the retry button of a server that does not answer (docs/features/offline.md,
 * user's wish of 26 September 2026); while the try itself runs (`at` null) it says so.
 */
export function RetryCountdown({ at }: { at: number | null }) {
  const now = useNow(at !== null);
  const seconds = secondsUntil(at, now);
  return <p className="muted retry-countdown" aria-live="polite">{seconds === null ? t("status.retrying") : t("status.retryIn", { n: seconds })}</p>;
}
