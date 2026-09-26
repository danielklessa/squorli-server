import { REPORT_REASONS, REPORT_TEXT_MAX, type ReportReason } from "@squorli/protocol";
import { useEffect, useState } from "react";
import type { ServerApi } from "./api";
import { ApiError } from "./api";
import { Icon } from "./Icon";
import { t } from "./i18n";

/** What is being reported: a message (the text shown as a reminder) or a member. */
export type ReportTarget = { kind: "message"; messageId: string; authorName: string; excerpt: string } | { kind: "member"; userId: string; name: string };

/**
 * The report dialog (docs/features/reports.md): reason from the fixed list, a free text, and who gets it (this server's
 * moderators). An own modal like every dialog of the client, no browser dialog. Reports to the directory (direct messages,
 * accounts, whole servers) are stage 4 of the plan and not offered here yet.
 */
export function ReportDialog({ api, target, serverName, onClose }: { api: ServerApi; target: ReportTarget; serverName: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.createReport(target.kind === "message" ? { kind: "message", messageId: target.messageId, reason, text: text.trim() || undefined } : { kind: "member", userId: target.userId, reason, text: text.trim() || undefined });
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "already_reported" ? t("report.alreadyReported") : e instanceof ApiError && e.code === "rate_limited" ? t("report.rateLimited") : String(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={onClose}>
      <div className="modal dialog report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="report-title">{target.kind === "message" ? t("report.titleMessage", { name: target.authorName }) : t("report.titleMember", { name: target.name })}</h2>
          <span className="spacer" />
          <button className="icon" onClick={onClose} title={t("common.close")}><Icon name="x" /></button>
        </header>
        <div className="dialog-body stack">
          {done ? (
            <>
              <p>{t("report.sent", { server: serverName })}</p>
              <div className="dialog-actions"><button onClick={onClose}>{t("common.close")}</button></div>
            </>
          ) : (
            <>
              {target.kind === "message" && target.excerpt && <blockquote className="report-excerpt muted">{target.excerpt}</blockquote>}
              <p className="muted small">{t("report.goesTo", { server: serverName })}</p>
              <div className="stack report-reasons" role="radiogroup" aria-label={t("report.reason")}>
                {REPORT_REASONS.map((r) => (
                  <label key={r} className="check"><input type="radio" name="report-reason" checked={reason === r} onChange={() => setReason(r)} /> {t(`report.reason.${r}`)}</label>
                ))}
              </div>
              <label className="stack">{t("report.text")}
                <textarea value={text} maxLength={REPORT_TEXT_MAX} rows={3} placeholder={t("report.textPlaceholder")} onChange={(e) => setText(e.target.value)} />
              </label>
              {err && <p className="error">{err}</p>}
              <div className="dialog-actions">
                <button className="secondary" onClick={onClose}>{t("common.cancel")}</button>
                <button className="danger" disabled={busy} onClick={() => void submit()}>{busy ? t("report.sending") : t("report.send")}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
