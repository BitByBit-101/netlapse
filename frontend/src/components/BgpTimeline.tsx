import type { BgpEvent } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  events: BgpEvent[];
}

const LABELS: Record<BgpEvent["event_type"], string> = {
  origin_announced: "Origin announced",
  origin_changed: "Origin ASN changed",
  origin_withdrawn: "Origin withdrawn",
  prefix_changed: "Prefix changed",
};

export default function BgpTimeline({ events }: Props) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No BGP-origin changes detected yet."
        hint="The detector compares ASN and prefix observations from Team Cymru."
      />
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event, i) => (
        <article
          key={event.id}
          style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }}
          className="animate-fade-up card card-hover px-3 py-3 sm:px-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-warn">{LABELS[event.event_type]}</span>
            <time className="font-mono text-[11px] text-muted">{new Date(event.captured_at).toLocaleString()}</time>
          </div>
          <p className="mt-2 font-mono text-xs text-ink/85">{event.ip}</p>

          {/* Stacks the before/after pair vertically on mobile so neither side
              is truncated mid-prefix. */}
          <div className="mt-1.5 flex flex-col gap-1 font-mono text-[11px] text-muted sm:flex-row sm:items-center sm:gap-2">
            <span className="break-all">
              AS{event.previous_asn || "—"} / {event.previous_prefix || "—"}
            </span>
            <span aria-hidden="true" className="text-ink/50 sm:shrink-0">
              →
            </span>
            <span className="break-all text-ink/70">
              AS{event.current_asn || "—"} / {event.current_prefix || "—"}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}
