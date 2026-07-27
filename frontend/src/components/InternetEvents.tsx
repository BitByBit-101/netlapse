import type { InternetEvent } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  events: InternetEvent[];
}

const SOURCE_LABELS: Record<InternetEvent["source"], string> = {
  dns: "DNS",
  cdn: "CDN",
  tls: "TLS",
  bgp: "BGP",
  health: "Health",
  route: "Route",
};

const TONES: Record<InternetEvent["severity"], string> = {
  critical: "bg-danger/15 text-danger border-danger/40",
  warning: "bg-warn/15 text-warn border-warn/40",
  info: "bg-signal/15 text-signal border-signal/40",
};

const EDGE: Record<InternetEvent["severity"], string> = {
  critical: "before:bg-danger",
  warning: "before:bg-warn",
  info: "before:bg-signal",
};

export default function InternetEvents({ events }: Props) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No material events recorded in this window."
        hint="Initial observations and later signal changes appear here."
      />
    );
  }

  return (
    <section>
      <header className="mb-5">
        <h2 className="font-mono text-sm text-ink">Internet events</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          A unified feed of DNS, CDN, TLS, routing, and health changes.
        </p>
      </header>
      <div className="space-y-3">
        {events.map((event, i) => (
          <article
            key={event.id}
            style={{ animationDelay: `${Math.min(i * 45, 350)}ms` }}
            className={`animate-fade-up card card-hover relative overflow-hidden px-3 py-3 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:opacity-60 sm:px-4 ${
              EDGE[event.severity]
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                    TONES[event.severity]
                  }`}
                >
                  {SOURCE_LABELS[event.source]}
                </span>
                {/* Wraps instead of truncating on mobile — a clipped event
                    title is unreadable on a narrow screen. */}
                <h3 className="min-w-0 break-words font-mono text-sm text-ink sm:truncate">{event.title}</h3>
              </div>
              <time className="shrink-0 font-mono text-[11px] text-muted">
                {new Date(event.captured_at).toLocaleString()}
              </time>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink/75">{event.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
