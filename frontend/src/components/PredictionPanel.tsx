import type { PredictionForecast } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  forecast: PredictionForecast | null;
}

const CONFIDENCE_TONES = {
  high: "text-signal border-signal/40 bg-signal/10",
  medium: "text-warn border-warn/40 bg-warn/10",
  low: "text-danger border-danger/40 bg-danger/10",
  insufficient: "text-muted border-line bg-surface2",
} as const;

export default function PredictionPanel({ forecast }: Props) {
  if (!forecast) {
    return (
      <EmptyState
        title="No forecast available."
        hint="A projection appears once enough successful latency samples have been collected."
      />
    );
  }

  if (forecast.points.length === 0) {
    return (
      <section className="card p-3 sm:p-4">
        <h2 className="font-mono text-sm text-ink">Latency forecast</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{forecast.confidence_reason}</p>
      </section>
    );
  }

  const trend = forecast.trend_ms_per_hour;
  const trendLabel = Math.abs(trend) < 1 ? "stable" : trend > 0 ? "rising" : "falling";
  const trendTone = Math.abs(trend) < 1 ? "text-ink" : trend > 0 ? "text-warn" : "text-signal";

  // Scale against what was actually observed. Intervals can legitimately exceed
  // that range on erratic data, so they're clamped for display only — a band
  // that always spans the full rail conveys nothing, and the exact ± figure is
  // printed next to each number anyway.
  const scaleMax = Math.max(forecast.observed_max_ms, ...forecast.points.map((p) => p.predicted_latency_ms));
  const pct = (value: number) => (scaleMax > 0 ? Math.max(0, Math.min(100, (value / scaleMax) * 100)) : 0);

  return (
    <section className="card p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <div>
          <h2 className="font-mono text-sm text-ink">Latency forecast</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Local least-squares trend over the last 24 hours of successful connections.
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-1 font-mono text-[10px] uppercase ${
            CONFIDENCE_TONES[forecast.confidence]
          }`}
        >
          {forecast.confidence} confidence
        </span>
      </header>

      {/* When the trend explains too little variance, say so up front rather
          than letting the reader assume the numbers are an extrapolation. */}
      {!forecast.trend_meaningful && (
        <p className="mt-4 rounded border border-warn/30 bg-warn/5 p-2.5 text-xs leading-relaxed text-warn">
          Showing the recent median, not a trend projection — latency is too erratic here for a straight line to mean
          anything (it explains {Math.round(forecast.r_squared * 100)}% of the variation).
        </p>
      )}

      <div className="mt-5 space-y-2.5">
        {forecast.points.map((point, i) => {
          const low = Math.max(0, point.predicted_latency_ms - point.interval_ms);
          const high = point.predicted_latency_ms + point.interval_ms;
          return (
            <div
              key={point.hours_ahead}
              style={{ animationDelay: `${i * 80}ms` }}
              className="animate-fade-in"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-mono text-[11px] uppercase text-muted">+{point.hours_ahead}h</p>
                <p className="font-mono text-sm text-ink">
                  {Math.round(point.predicted_latency_ms)}
                  <span className="ml-0.5 text-[10px] text-muted">ms</span>
                  {point.interval_ms > 0 && (
                    <span className="ml-1.5 font-mono text-[10px] text-muted">
                      ± {Math.round(point.interval_ms)}
                    </span>
                  )}
                </p>
              </div>
              {/* Rail showing the prediction interval, not just a point value.
                  The wider the band, the less the number should be trusted. */}
              <div
                className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-surface2"
                role="img"
                aria-label={`Projected ${Math.round(point.predicted_latency_ms)} ms, between ${Math.round(low)} and ${Math.round(high)} ms`}
              >
                <div
                  className="absolute inset-y-0 rounded-full bg-signal/20 transition-all duration-700 ease-smooth"
                  style={{ left: `${pct(low)}%`, width: `${Math.max(1, pct(high) - pct(low))}%` }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-signal transition-all duration-700 ease-smooth"
                  style={{ left: `${pct(point.predicted_latency_ms)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* What actually happened, as the yardstick for the projections above. */}
      <div className="mt-5 rounded border border-line bg-surface2/40 p-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Observed in this window</p>
        <div className="mt-2 flex items-baseline gap-3 font-mono text-xs">
          <span className="text-signal">{Math.round(forecast.observed_min_ms)} ms low</span>
          <span className="text-ink">{Math.round(forecast.median_latency_ms)} ms median</span>
          <span className="text-warn">{Math.round(forecast.observed_max_ms)} ms high</span>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-3 text-sm xs:grid-cols-2 sm:grid-cols-4">
        <div>
          <dt className="font-mono text-[10px] uppercase text-muted">Baseline</dt>
          <dd className="mt-1 font-mono text-ink">{Math.round(forecast.baseline_latency_ms)} ms</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-muted">Trend</dt>
          <dd className={`mt-1 font-mono ${trendTone}`}>
            {trendLabel}{" "}
            <span className="text-muted">
              ({trend > 0 ? "+" : ""}
              {trend.toFixed(1)} ms/h)
            </span>
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-muted" title="Share of the variation the trend line explains">
            Fit
          </dt>
          <dd className="mt-1 font-mono text-ink">
            R² {forecast.r_squared.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-muted">Reachability</dt>
          <dd className="mt-1 font-mono text-ink">
            {Math.round(forecast.recent_success_rate * 100)}%{" "}
            <span className="text-muted">({forecast.sample_count})</span>
          </dd>
        </div>
      </dl>

      <p className="mt-5 border-t border-line pt-3 text-xs leading-relaxed text-muted">{forecast.confidence_reason}</p>
    </section>
  );
}
