import { useEffect, useId, useRef } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, busyLabel, busy, danger = false, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => element.close();
  }, []);

  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={messageId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className={`confirm-symbol${danger ? " confirm-symbol-danger" : ""}`} aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {danger ? <><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></> : <><path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z" /><path d="m8 12 3 3 5-6" /></>}
      </svg>
    </div>
    <h2 id={titleId}>{title}</h2>
    <p id={messageId}>{message}</p>
    <div className="confirm-actions">
      <button ref={cancel} type="button" className="confirm-cancel" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className={`confirm-submit${danger ? " confirm-submit-danger" : ""}`} disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button>
    </div>
  </dialog>;
}
