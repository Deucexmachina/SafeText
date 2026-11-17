import { useEffect, useId, useRef, useState } from "react";

interface ConfirmValues {
  password: string;
  reason: string;
}

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  danger?: boolean;
  mode?: "confirm" | "error";
  password?: boolean;
  reason?: boolean;
  /** When false, the reason field is shown but may be left empty. */
  reasonRequired?: boolean;
  /** Helper text under the reason field. */
  reasonHint?: string;
  error?: string | null;
  onConfirm: (values: ConfirmValues) => void;
  onCancel: () => void;
}

const REASON_MAX = 500;

export function ConfirmDialog({ title, message, confirmLabel, busyLabel, busy, danger = false, mode = "confirm", password = false, reason = false, reasonRequired = true, reasonHint = "Shown to the user when they try to log in.", error = null, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  const [passwordValue, setPasswordValue] = useState("");
  const [reasonValue, setReasonValue] = useState("");

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    (cancel.current ?? confirm.current)?.focus();
    return () => element.close();
  }, []);

  const missingFields = (password && !passwordValue) || (reason && reasonRequired && !reasonValue.trim());

  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={messageId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className={`confirm-symbol${danger || mode === "error" ? " confirm-symbol-danger" : ""}`} aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {mode === "error" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></> : danger ? <><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></> : <><path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z" /><path d="m8 12 3 3 5-6" /></>}
      </svg>
    </div>
    <h2 id={titleId}>{title}</h2>
    <p id={messageId}>{message}</p>
    {reason && <div className="dialog-field">
      <label className="field-label" htmlFor="dialog-reason">
        Reason{!reasonRequired && <span className="dialog-optional"> (optional)</span>}
      </label>
      <textarea id="dialog-reason" rows={3} maxLength={REASON_MAX} disabled={busy} required={reasonRequired}
        placeholder="e.g. spamming scans" value={reasonValue} aria-describedby="dialog-reason-hint dialog-reason-count"
        onChange={event => setReasonValue(event.target.value)} />
      <div className="dialog-reason-meta">
        <p id="dialog-reason-hint" className="hint">{reasonHint}</p>
        <p id="dialog-reason-count" className="hint dialog-count" aria-live="polite">{reasonValue.length}/{REASON_MAX}</p>
      </div>
    </div>}
    {password && <div className="dialog-field">
      <label className="field-label" htmlFor="dialog-password">Your password</label>
      <input id="dialog-password" type="password" autoComplete="current-password" disabled={busy}
        value={passwordValue} onChange={event => setPasswordValue(event.target.value)} />
      <p className="hint">Confirm with your own account password.</p>
    </div>}
    {error && <p role="alert" className="error-box">{error}</p>}
    <div className="confirm-actions">
      {mode === "confirm" && <button ref={cancel} type="button" className="confirm-cancel" disabled={busy} onClick={onCancel}>Cancel</button>}
      <button ref={confirm} type="button" className={`confirm-submit${danger || mode === "error" ? " confirm-submit-danger" : ""}`}
        disabled={busy || missingFields}
        onClick={() => onConfirm({ password: passwordValue, reason: reasonValue.trim() })}>{busy ? busyLabel : confirmLabel}</button>
    </div>
  </dialog>;
}
