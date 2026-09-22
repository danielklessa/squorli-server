import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";

/**
 * A button that puts `text` on the clipboard and says so (user's wish, 23 September 2026: a press on "Kopieren" must
 * answer): the label turns into "Kopiert" with a check for 1.5 s, or into "Kopieren nicht möglich" when the browser
 * refuses (no secure context, no permission). `label` is the resting text; `title` may carry the text itself.
 */
export function CopyButton({ text, label, title, className = "secondary small" }: { text: string; label: string; title?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => { if (state === "idle") return; const timer = setTimeout(() => setState("idle"), 1500); return () => clearTimeout(timer); }, [state]);
  const copy = async () => {
    try { if (!navigator.clipboard) throw new Error("no clipboard"); await navigator.clipboard.writeText(text); setState("copied"); }
    catch { setState("failed"); }
  };
  return (
    <button type="button" className={className} title={title ?? text} aria-live="polite" onClick={() => void copy()}>
      {state === "copied" ? <><Icon name="check" /> {t("common.copied")}</> : state === "failed" ? t("common.copyFailed") : label}
    </button>
  );
}
