import type { RouteSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  snapshots: RouteSnapshot[];
}

export default function RouteTimeline({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No route captures yet."
        hint="The first traceroute is recorded when a domain is added."
      />
    );
  }

  const latest = snapshots[snapshots.length - 1];
  const responding = latest.hops.filter((hop) => !hop.timed_out).length;

  return (
    <section className="card p-3 sm:p-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2 className="font-mono text-sm text-ink">Latest route</h2>
          <p className="mt-1 font-mono text-[11px] text-muted sm:text-xs">
            {new Date(latest.captured_at).toLocaleString()}
          </p>
        </div>
        <span className={`shrink-0 font-mono text-[10px] uppercase ${latest.success ? "text-signal" : "text-danger"}`}>
          {latest.success ? `${responding}/${latest.hops.length} responding` : "capture failed"}
        </span>
      </div>

      {latest.success ? (
        <ol className="space-y-0">
          {latest.hops.map((hop, index) => (
            <li
              key={`${hop.hop}-${hop.address}-${index}`}
              style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
              className="animate-fade-in group relative flex min-h-10 items-center gap-3 pl-8"
            >
              {index < latest.hops.length - 1 && (
                <span aria-hidden="true" className="absolute bottom-0 left-[11px] top-6 w-px bg-line" />
              )}
              <span
                className={`absolute left-0 grid h-6 w-6 place-items-center rounded-full border font-mono text-[10px] transition-colors ${
                  hop.timed_out ? "border-warn text-warn" : "border-line text-muted group-hover:border-signal/50 group-hover:text-signal"
                }`}
              >
                {hop.hop}
              </span>
              <span className="flex-1 truncate font-mono text-xs text-ink/85" title={hop.address || undefined}>
                {hop.address || "request timed out"}
              </span>
              <span className={`shrink-0 font-mono text-xs ${hop.timed_out ? "text-warn" : "text-muted"}`}>
                {hop.timed_out ? "timeout" : `${Math.round(hop.latency_ms)} ms`}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="break-words font-mono text-xs text-danger">{latest.error || "Traceroute could not complete."}</p>
      )}

      <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-muted">
        {snapshots.length} capture{snapshots.length === 1 ? "" : "s"} recorded
      </p>
    </section>
  );
}
