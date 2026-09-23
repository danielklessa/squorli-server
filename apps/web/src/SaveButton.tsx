import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";

/**
 * A save button that answers (user's rule, 23 September 2026, like every copy button): "Speichern", while the request
 * runs "Speichert …", then a check with "Gespeichert" for 1.5 s, or "Nicht gespeichert" when the request failed (the
 * caller's `run` shows the reason). Verwaltung > Server and > Rollen use it; the channel dialog answers the same way.
 */
export function SaveButton({ onSave, disabled = false, label, className }: { onSave: () => Promise<unknown>; disabled?: boolean; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const answer = (s: "saved" | "failed") => { setState(s); if (timer.current) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setState("idle"), 1500); };
  return (
    <span className="save-answer">
      <button className={className} disabled={disabled || state === "saving"} onClick={() => { setState("saving"); onSave().then(() => answer("saved"), () => answer("failed")); }}>{label ?? t("common.save")}</button>
      <span className={`small save-status is-${state}`} role="status" aria-live="polite">
        {state === "saving" ? t("common.saving") : state === "saved" ? <><Icon name="check" /> {t("common.saved")}</> : state === "failed" ? <><Icon name="x" /> {t("common.saveFailed")}</> : ""}
      </span>
    </span>
  );
}
