import { useEffect, useRef } from "react";
import { Spinner } from "./Loaders";

interface Props {
  /** Short question, e.g. "Stop tracking github.com?" */
  title: string;
  /** What the user is agreeing to. Spell out anything irreversible. */
  body: React.ReactNode;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  /** True while the confirmed action is in flight. */
  busy?: boolean;
  /** Surfaced in place of the buttons' normal state when the action failed. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation for irreversible actions.
 *
 * Deliberately not window.confirm(): that cannot be styled, cannot show the
 * in-flight or error state, and is suppressible by the browser.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the confirm button on open so the dialog is immediately keyboard
  // operable, and so screen readers announce the panel rather than leaving
  // focus stranded on the now-hidden trigger.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onCancel();
        return;
      }
      // Trap Tab inside the panel. Without this, focus walks into the page
      // behind the overlay, which is inert but still reachable.
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      // z-50 clears the mobile drawer's backdrop at z-30.
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-void/80 p-4 backdrop-blur-sm"
      // Clicking the backdrop cancels, but not while the request is running:
      // dismissing mid-flight would leave the user unsure whether it happened.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="animate-scale-in w-full max-w-sm rounded-xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span
            aria-hidden="true"
            className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
              destructive ? "bg-danger/15 text-danger" : "bg-signal/15 text-signal"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 4.5v3.2M7 10h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </span>
          <h2 id="confirm-title" className="font-mono text-sm leading-6 text-ink">
            {title}
          </h2>
        </div>

        <div id="confirm-body" className="px-5 py-4 text-sm leading-relaxed text-muted">
          {body}
        </div>

        {error && (
          <p className="animate-fade-in mx-5 mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-muted transition-all hover:border-line/80 hover:text-ink active:scale-95 disabled:opacity-40 disabled:active:scale-100"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy}
            data-destructive={destructive ? "" : undefined}
            className={`flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100 ${
              destructive
                ? "border-danger/50 bg-danger/15 text-danger hover:bg-danger/25"
                : "border-signal/50 bg-signal/15 text-signal hover:bg-signal/25"
            }`}
          >
            {busy && <Spinner className="h-3 w-3" />}
            {busy ? "Working" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
