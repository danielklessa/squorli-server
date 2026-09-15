import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "./i18n";

/**
 * Replacement for window.confirm/prompt: an own modal that sits above everything.
 * askConfirm() and askInput() return promises; DialogHost renders the currently active dialog.
 * There is only ever one dialog at a time; further ones wait in the queue.
 */
type Base = { title: string; text?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
export type ConfirmOptions = Base;
export type InputOptions = Base & { label?: string; placeholder?: string; initial?: string; maxLength?: number; optional?: boolean };

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "input"; opts: InputOptions; resolve: (value: string | null) => void };

const queue: Pending[] = [];
let notify: (() => void) | null = null;
const enqueue = (p: Pending) => { queue.push(p); notify?.(); };
const finish = () => { queue.shift(); notify?.(); };

export const askConfirm = (opts: ConfirmOptions) => new Promise<boolean>((resolve) => enqueue({ kind: "confirm", opts, resolve }));
export const askInput = (opts: InputOptions) => new Promise<string | null>((resolve) => enqueue({ kind: "input", opts, resolve }));

export function DialogHost() {
  const [, rerender] = useState(0);
  useEffect(() => { notify = () => rerender((n) => n + 1); return () => { notify = null; }; }, []);
  const current = queue[0];
  if (!current) return null;
  return current.kind === "confirm"
    ? <ConfirmDialog key={queue.length} opts={current.opts} onDone={(ok) => { current.resolve(ok); finish(); }} />
    : <InputDialog key={queue.length} opts={current.opts} onDone={(v) => { current.resolve(v); finish(); }} />;
}

function Frame({ opts, onCancel, children }: { opts: Base; onCancel: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={onCancel}>
      <div className="modal dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="dialog-title">{opts.title}</h2>
        {opts.text && <p className="dialog-text">{opts.text}</p>}
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Frame opts={opts} onCancel={() => onDone(false)}>
      <div className="dialog-actions">
        <button className="secondary" onClick={() => onDone(false)}>{opts.cancelLabel ?? t("common.cancel")}</button>
        <button ref={ref} className={opts.danger ? "danger" : ""} onClick={() => onDone(true)}>{opts.confirmLabel ?? t("common.ok")}</button>
      </div>
    </Frame>
  );
}

function InputDialog({ opts, onDone }: { opts: InputOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? "");
  const ok = opts.optional || value.trim().length > 0;
  const submit = () => { if (ok) onDone(value.trim()); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
  return (
    <Frame opts={opts} onCancel={() => onDone(null)}>
      <label className="stack">{opts.label ?? ""}
        <input autoFocus value={value} placeholder={opts.placeholder} maxLength={opts.maxLength ?? 200} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} />
      </label>
      <div className="dialog-actions">
        <button className="secondary" onClick={() => onDone(null)}>{opts.cancelLabel ?? t("common.cancel")}</button>
        <button className={opts.danger ? "danger" : ""} disabled={!ok} onClick={submit}>{opts.confirmLabel ?? t("common.ok")}</button>
      </div>
    </Frame>
  );
}
