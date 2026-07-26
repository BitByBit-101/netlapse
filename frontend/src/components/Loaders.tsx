/**
 * Shared loading primitives.
 *
 * Two rules the rest of the UI relies on:
 *  - Skeletons mirror the shape of the content they replace, so the layout
 *    doesn't jump when real data lands.
 *  - Every loader is aria-labelled and marked role="status" so screen readers
 *    announce "loading" instead of reading a wall of empty boxes.
 */

import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  /** Escape hatch for widths that vary per row (staggered skeleton lines). */
  style?: CSSProperties;
}

/** A single shimmering block. Pass sizing via className. */
export function Skeleton({ className = "", style }: SkeletonProps) {
  return <div style={style} className={`skeleton ${className}`} />;
}

/** Concentric sonar rings — the app's signature "probing the network" loader. */
export function SonarLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col items-center justify-center gap-4 py-10">
      <div className="relative h-16 w-16">
        {[0, 0.66, 1.32].map((delay) => (
          <span
            key={delay}
            style={{ animationDelay: `${delay}s` }}
            className="absolute inset-0 rounded-full border border-signal animate-sonar"
          />
        ))}
        <span className="absolute inset-0 m-auto h-2.5 w-2.5 rounded-full bg-signal shadow-glow" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted animate-pulse-soft">{label}</p>
    </div>
  );
}

/** Small inline spinner for buttons and tight spaces. */
export function Spinner({ className = "h-4 w-4" }: SkeletonProps) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70 ${className}`}
    />
  );
}

/** Indeterminate top-of-page progress bar shown while a refresh is in flight. */
export function ProgressBar({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden={!active}
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-300 ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="h-full w-1/4 animate-slide bg-gradient-to-r from-transparent via-signal to-transparent" />
    </div>
  );
}

/** Equaliser bars, used where a chart is about to appear. */
export function ChartSkeleton({ height = 220 }: { height?: number }) {
  // Deterministic pseudo-random heights: a fixed pattern reads as data, and
  // avoids re-randomising on every render.
  const bars = [0.45, 0.72, 0.38, 0.86, 0.55, 0.94, 0.42, 0.68, 0.5, 0.8, 0.35, 0.62, 0.75, 0.48, 0.9, 0.58];

  return (
    <div role="status" aria-label="Loading chart" style={{ height }} className="flex items-end gap-1.5 px-1 pb-6 pt-2">
      {bars.map((scale, i) => (
        <div
          key={i}
          style={{ height: `${scale * 100}%`, animationDelay: `${i * 0.07}s`, transformOrigin: "bottom" }}
          className="flex-1 rounded-t bg-gradient-to-t from-signal/25 to-signal/5 animate-bar-flex"
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for the timeline components (DNS/CDN/ASN/TLS/BGP), which all share
 * a dot-and-rail-plus-card layout.
 */
export function TimelineSkeleton({ rows = 3, lines = 3 }: { rows?: number; lines?: number }) {
  return (
    <div role="status" aria-label="Loading history" className="space-y-4">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="relative pl-6" style={{ opacity: 1 - row * 0.22 }}>
          <Skeleton className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full" />
          {row < rows - 1 && <div className="absolute left-[4.5px] top-4 bottom-[-1rem] w-px bg-line" />}
          <div className="rounded-lg border border-line bg-surface/40 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="mt-3 space-y-2">
              {Array.from({ length: lines }).map((_, line) => (
                <div key={line} className="flex gap-3">
                  <Skeleton className="h-3 w-12 shrink-0" />
                  <Skeleton className="h-3 flex-1" style={{ maxWidth: `${80 - line * 12}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for stacked card feeds (events, similarity, investigator). */
export function CardListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          style={{ opacity: 1 - row * 0.18 }}
          className="rounded-lg border border-line bg-surface/40 px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-3.5 w-40" />
            </div>
            <Skeleton className="h-3 w-24 shrink-0" />
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for the sidebar domain list. */
export function DomainListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading domains" className="space-y-1 py-2">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="px-4 py-2" style={{ opacity: 1 - row * 0.15 }}>
          <Skeleton className="h-3.5" style={{ width: `${70 - row * 8}%` }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Shared empty state. Distinct from the loading state on purpose: an empty
 * state is a fact about the data, a loader is a fact about the request.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="animate-fade-in rounded-lg border border-dashed border-line/70 bg-surface/20 px-5 py-8 text-center">
      <p className="text-sm text-ink/70">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}
