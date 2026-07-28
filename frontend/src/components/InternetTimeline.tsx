import { useState } from "react";
import type { InternetEvent } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  events: InternetEvent[];
}

const SOURCES: InternetEvent["source"][] = ["dns", "cdn", "tls", "bgp", "health", "route"];

const SOURCE_LABELS: Record<InternetEvent["source"], string> = {
  dns: "DNS",
  cdn: "CDN",
  tls: "TLS",
  bgp: "BGP",
  health: "Health",
  route: "Route",
};

const MARKERS: Record<InternetEvent["severity"], string> = {
  critical: "bg-danger border-danger",
  warning: "bg-warn border-warn",
  info: "bg-signal border-signal",
};

function dateKey(timestamp: string) {
  return new Date(timestamp).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

export default function InternetTimeline({ events }: Props) {
  const [enabledSources, setEnabledSources] = useState<InternetEvent["source"][]>(SOURCES);
  const filtered = events.filter((event) => enabledSources.includes(event.source));
  const groups = filtered.reduce<Record<string, InternetEvent[]>>((all, event) => {
    const key = dateKey(event.captured_at);
    (all[key] ??= []).push(event);
    return all;
  }, {});

  const toggleSource = (source: InternetEvent["source"]) => {
    setEnabledSources((current) =>
      current.includes(source) ? current.filter((value) => value !== source) : [...current, source]
    );
  };

  if (events.length === 0) {
    return (
      <EmptyState
        title="No timeline entries yet."
        hint="Material signal changes will appear here as collection history grows."
      />
    );
  }

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="font-mono text-sm text-ink">Internet timeline</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">A chronological cross-module history for this domain.</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted">
          {filtered.length} of {events.length} events
        </span>
      </header>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-line pb-4" role="group" aria-label="Filter by source">
        {SOURCES.map((source) => {
          const enabled = enabledSources.includes(source);
          return (
            <button
              key={source}
              type="button"
              aria-pressed={enabled}
              onClick={() => toggleSource(source)}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] uppercase transition-all duration-200 active:scale-95 ${
                enabled
                  ? "border-signal/50 bg-signal/10 text-signal"
                  : "border-line text-muted hover:border-line/80 hover:text-ink"
              }`}
            >
              {SOURCE_LABELS[source]}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No events match the current source filters." hint="Re-enable a source above to see its events." />
      ) : (
        <div className="space-y-7">
          {Object.entries(groups).map(([date, entries]) => (
            <section key={date}>
              {/* Sticky date header keeps context while scrolling a long day. */}
              <h3 className="sticky top-0 z-10 -mx-1 mb-3 bg-void/90 px-1 py-1 font-mono text-xs uppercase text-muted backdrop-blur-sm lg:top-0">
                {date}
              </h3>
              <div className="relative ml-1 space-y-4 border-l border-line pl-5">
                {entries.map((event, i) => (
                  <article
                    key={event.id}
                    style={{ animationDelay: `${Math.min(i * 45, 300)}ms` }}
                    className="animate-fade-up relative"
                  >
                    <span
                      className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border ${
                        MARKERS[event.severity]
                      }`}
                    />
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <time className="font-mono text-[11px] text-muted">
                        {new Date(event.captured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                      <span className="font-mono text-[10px] uppercase text-signal">{SOURCE_LABELS[event.source]}</span>
                      <h4 className="min-w-0 break-words font-mono text-sm text-ink">{event.title}</h4>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-ink/70">{event.summary}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
