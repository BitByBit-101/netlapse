import { useState } from "react";
import type { Domain } from "../api";
import { DomainListSkeleton, Spinner } from "./Loaders";

interface Props {
  domains: Domain[];
  selected: string | null;
  onSelect: (name: string) => void;
  onAdd: (name: string) => Promise<void>;
  /** Asks the parent to open the delete confirmation for this domain. */
  onRequestDelete: (name: string) => void;
  /** First domain-list fetch still in flight. */
  loading?: boolean;
  /** Dismiss the mobile drawer. Not rendered at lg and up. */
  onClose?: () => void;
}

export default function DomainList({
  domains,
  selected,
  onSelect,
  onAdd,
  onRequestDelete,
  loading = false,
  onClose,
}: Props) {
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = input.trim().toLowerCase();
    if (!name) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAdd(name);
      setInput("");
    } catch (err) {
      // Previously this failed silently — the input just stayed put with no
      // indication the domain was rejected.
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <aside className="flex h-full flex-col border-r border-line bg-surface/80 backdrop-blur-xl lg:bg-surface/60">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-5">
        <a
          href="#/"
          className="group rounded transition-opacity hover:opacity-80"
          title="Back to the landing page"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">netlapse</p>
          <p className="mt-1 text-xs text-muted">the internet time machine</p>
        </a>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close domain list"
            className="grid h-7 w-7 shrink-0 place-items-center rounded border border-line text-muted transition-colors hover:border-signal/50 hover:text-signal active:scale-95 lg:hidden"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <form onSubmit={submit} className="border-b border-line px-4 py-3">
        <label htmlFor="track-domain" className="font-mono text-[11px] uppercase tracking-wide text-muted">
          Track a domain
        </label>
        <div className="mt-2 flex gap-1.5">
          <input
            id="track-domain"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (addError) setAddError(null);
            }}
            placeholder="github.com"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-sm transition-colors placeholder:text-muted/60 hover:border-line/80 focus:border-signal/50 focus:outline-none focus:ring-1 focus:ring-signal"
          />
          <button
            type="submit"
            disabled={adding || !input.trim()}
            aria-label="Track domain"
            className="grid w-9 shrink-0 place-items-center rounded border border-signal/40 bg-signal/10 text-signal transition-all hover:bg-signal/20 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
          >
            {adding ? <Spinner className="h-3.5 w-3.5" /> : <span className="text-sm leading-none">+</span>}
          </button>
        </div>
        {addError && <p className="animate-fade-in mt-2 font-mono text-[11px] leading-relaxed text-danger">{addError}</p>}
      </form>

      <nav aria-label="Tracked domains" className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <DomainListSkeleton />
        ) : domains.length === 0 ? (
          <p className="px-4 py-6 text-sm leading-relaxed text-muted">
            No domains tracked yet. Add one above to start recording history.
          </p>
        ) : (
          domains.map((d, i) => (
            // A row is a select button plus a remove button. They are siblings
            // in a wrapper rather than nested, because a button inside a button
            // is invalid HTML and browsers drop the inner one.
            <div
              key={d.id}
              style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
              className={`animate-fade-in group flex items-stretch border-l-2 transition-all duration-200 ${
                selected === d.name
                  ? "border-signal bg-surface2"
                  : "border-transparent hover:border-line hover:bg-surface2/60"
              }`}
            >
              <button
                onClick={() => onSelect(d.name)}
                aria-current={selected === d.name ? "true" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-4 pr-1 text-left font-mono text-sm transition-colors ${
                  selected === d.name ? "text-ink" : "text-muted group-hover:text-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                    selected === d.name ? "bg-signal" : "bg-muted/40 group-hover:bg-muted"
                  }`}
                />
                <span className="truncate">{d.name}</span>
              </button>
              <button
                onClick={() => onRequestDelete(d.name)}
                aria-label={`Stop tracking ${d.name}`}
                title={`Stop tracking ${d.name}`}
                // Hidden until the row is hovered or the button itself has
                // keyboard focus, so the list stays calm but remains reachable
                // by tab. On touch, where there is no hover, it stays visible.
                data-destructive=""
                className="my-auto mr-2 grid h-7 w-7 shrink-0 place-items-center rounded text-muted/0 transition-colors hover:bg-danger/15 hover:text-danger focus-visible:text-danger active:scale-90 group-hover:text-muted/70 max-lg:text-muted/50"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 3.5h7M4.75 3.5V2.6a.6.6 0 0 1 .6-.6h1.3a.6.6 0 0 1 .6.6v.9M3.6 3.5l.35 5.5a.7.7 0 0 0 .7.65h2.7a.7.7 0 0 0 .7-.65l.35-5.5"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted/70">
          {loading ? "loading" : `${domains.length} tracked`}
        </p>
      </div>
    </aside>
  );
}
