import type { CdnSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  snapshots: CdnSnapshot[];
}

/**
 * How much a detection method is actually worth.
 *
 * These are not cosmetic. A CNAME to `reddit.map.fastly.net` is near-proof that
 * Fastly fronts the domain; an ASN match only tells you who owns the IP, which
 * is a materially weaker claim. Showing them identically invited the reader to
 * trust a guess as much as a fact.
 */
function confidenceOf(via: string): { label: string; tone: string; title: string } {
  if (via === "cname") {
    return {
      label: "high",
      tone: "border-signal/40 bg-signal/10 text-signal",
      title: "The domain's CNAME points at this provider's edge network — near-conclusive.",
    };
  }
  if (via.startsWith("header:")) {
    return {
      label: "high",
      tone: "border-signal/40 bg-signal/10 text-signal",
      title: `The ${via.slice(7)} response header is specific to this provider.`,
    };
  }
  if (via === "asn") {
    return {
      label: "inferred",
      tone: "border-warn/40 bg-warn/10 text-warn",
      title: "Derived from who owns the IP address, not from an edge fingerprint. The domain may be self-hosted rather than behind a CDN.",
    };
  }
  return {
    label: "none",
    tone: "border-line bg-surface2 text-muted",
    title: "The host answered, but no known provider fingerprint matched.",
  };
}

function humanDuration(fromISO: string, toISO: string): string {
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function CdnTimeline({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No CDN detections yet."
        hint="The collector checks the domain's CNAME target, response headers across every redirect hop, and the owning ASN — check back after it ticks."
      />
    );
  }

  // Oldest-first from the API. Reverse for display, newest at the top.
  const reversed = [...snapshots].reverse();
  const current = reversed[0];
  const currentConfidence = confidenceOf(current.detected_via);

  // A "migration" is a genuine provider switch, not merely a new snapshot. The
  // collector also records evidence-only changes (a different edge node ID for
  // the same provider), and counting those as migrations overstated churn.
  const migrations = reversed.filter((snap, i) => {
    const older = reversed[i + 1];
    return older !== undefined && older.provider !== snap.provider;
  }).length;

  const heldSince = (() => {
    // Walk back while the provider is unchanged to find when it took over.
    let index = 0;
    while (index + 1 < reversed.length && reversed[index + 1].provider === current.provider) index++;
    return reversed[index].captured_at;
  })();

  return (
    <div className="space-y-4">
      {/* Current state, stated once and plainly. Previously the reader had to
          infer "what is it now?" from the top row of a flat list. */}
      <section className="card p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Currently fronted by</p>
            <p className="mt-1 truncate font-mono text-lg text-ink sm:text-xl" title={current.provider}>
              {current.provider}
            </p>
          </div>
          <span
            title={currentConfidence.title}
            className={`shrink-0 cursor-help rounded border px-2 py-1 font-mono text-[10px] uppercase ${currentConfidence.tone}`}
          >
            {currentConfidence.label} confidence
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
          <div>
            <dt className="font-mono text-[10px] uppercase text-muted">Detected via</dt>
            <dd className="mt-1 truncate font-mono text-xs text-ink" title={current.detected_via || "no signal"}>
              {current.detected_via === "no-signal" ? "no signal" : current.detected_via || "—"}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase text-muted">Unchanged for</dt>
            <dd className="mt-1 font-mono text-xs text-ink">
              {humanDuration(heldSince, new Date().toISOString()) || "—"}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase text-muted">Migrations</dt>
            <dd className="mt-1 font-mono text-xs text-ink">{migrations}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase text-muted">Observations</dt>
            <dd className="mt-1 font-mono text-xs text-ink">{snapshots.length}</dd>
          </div>
        </dl>

        <p className="mt-3 truncate border-t border-line pt-3 font-mono text-[11px] text-muted" title={current.evidence}>
          <span className="text-muted/60">evidence:</span> {current.evidence || "—"}
        </p>
      </section>

      <div className="space-y-3">
        {reversed.map((snap, i) => {
          const isLatest = i === 0;
          const older = reversed[i + 1];
          const isMigration = older !== undefined && older.provider !== snap.provider;
          const confidence = confidenceOf(snap.detected_via);

          return (
            <div
              key={snap.id}
              style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
              className="animate-fade-up relative pl-6"
            >
              <div
                className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border transition-colors ${
                  isLatest
                    ? "border-signal bg-signal shadow-glow"
                    : isMigration
                      ? "border-warn bg-warn/60"
                      : "border-muted bg-surface2"
                }`}
              />
              {i < reversed.length - 1 && <div className="absolute bottom-[-0.75rem] left-[4.5px] top-4 w-px bg-line" />}

              <div className="card card-hover flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-sm text-ink">{snap.provider}</span>
                    {isLatest && (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-signal">current</span>
                    )}
                    {/* Name what actually happened, so a migration doesn't read
                        the same as a routine re-detection. */}
                    {isMigration && (
                      <span
                        className="shrink-0 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-warn"
                        title={`Moved from ${older.provider}`}
                      >
                        from {older.provider}
                      </span>
                    )}
                    {!isMigration && older !== undefined && (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted/60">
                        re-detected
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-muted sm:text-xs">
                    {new Date(snap.captured_at).toLocaleString()}
                  </span>
                </div>
                <div className="min-w-0 border-t border-line/60 pt-2 sm:border-0 sm:pt-0 sm:text-right">
                  <p
                    title={confidence.title}
                    className="cursor-help font-mono text-[11px] uppercase text-muted"
                  >
                    {snap.detected_via === "no-signal" ? "no signal" : snap.detected_via || "no signal"}
                  </p>
                  <p className="truncate font-mono text-xs text-ink/70 sm:max-w-[220px]" title={snap.evidence}>
                    {snap.evidence || "—"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
