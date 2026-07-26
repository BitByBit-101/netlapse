import type { HealthSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  snapshots: HealthSnapshot[];
}

const STATUS_STYLE = {
  healthy: "bg-signal",
  degraded: "bg-warn",
  outage: "bg-danger",
} as const;

const STATUS_TEXT = {
  healthy: "text-signal",
  degraded: "text-warn",
  outage: "text-danger",
} as const;

export default function WeatherHeatmap({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No health windows yet."
        hint="Health is calculated every two minutes from recent connection samples."
      />
    );
  }

  const latest = snapshots[snapshots.length - 1];
  const counts = snapshots.reduce(
    (total, snapshot) => ({ ...total, [snapshot.status]: total[snapshot.status] + 1 }),
    { healthy: 0, degraded: 0, outage: 0 }
  );

  return (
    <section className="card p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2 className="font-mono text-sm text-ink">Internet weather</h2>
          <p className="mt-1 text-xs text-muted">Seven-day availability heatmap</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 font-mono text-xs uppercase ${STATUS_TEXT[latest.status]}`}>
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[latest.status]} ${
              latest.status === "healthy" ? "animate-pulse-soft" : ""
            }`}
          />
          {latest.status}
        </span>
      </div>

      {/* Cells grow from 8px on a phone to 12px at sm — at 10px fixed they were
          both hard to hit on touch and wasteful of the wider grid. */}
      <div
        className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(8px,1fr))] gap-1 sm:grid-cols-[repeat(auto-fill,minmax(12px,1fr))]"
        aria-label="Health history"
      >
        {snapshots.map((snapshot, i) => (
          <span
            key={snapshot.id}
            style={{ animationDelay: `${Math.min(i * 4, 500)}ms` }}
            className={`animate-scale-in aspect-square min-h-2 rounded-sm transition-transform hover:scale-125 ${
              STATUS_STYLE[snapshot.status]
            }`}
            title={`${new Date(snapshot.captured_at).toLocaleString()}: ${snapshot.status}, ${Math.round(
              snapshot.success_rate * 100
            )}% successful`}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3 font-mono text-[11px] text-muted">
        <span>
          <i aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-signal" />
          healthy {counts.healthy}
        </span>
        <span>
          <i aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-warn" />
          degraded {counts.degraded}
        </span>
        <span>
          <i aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-danger" />
          outage {counts.outage}
        </span>
        <span className="w-full sm:ml-auto sm:w-auto sm:text-right">
          {Math.round(latest.success_rate * 100)}% success · {Math.round(latest.average_latency_ms)} ms
        </span>
      </div>
    </section>
  );
}
