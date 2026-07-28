import type { SimilarDomain } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  matches: SimilarDomain[];
}

/**
 * Weight of each signal, mirroring similarity.go. Shown so a score is
 * auditable rather than a mystery number: 60% of it comes from CDN and ASN
 * overlap, which is why two Cloudflare sites rank highly without being
 * related in any other sense.
 */
const SIGNAL_WEIGHTS: Record<string, string> = {
  "same CDN provider": "30%",
  "shared origin ASN": "30%",
  "shared resolved IP": "20%",
  "same health status": "10%",
  "similar recent latency": "10%",
};

function band(score: number): { label: string; tone: string } {
  if (score >= 0.6) return { label: "strong overlap", tone: "text-signal" };
  if (score >= 0.3) return { label: "partial overlap", tone: "text-warn" };
  return { label: "little overlap", tone: "text-muted" };
}

export default function SimilaritySearch({ matches }: Props) {
  if (matches.length === 0) {
    return (
      <EmptyState
        title="Nothing to compare yet."
        hint="Add at least one more domain to compare network profiles."
      />
    );
  }

  return (
    <section>
      <header className="mb-5">
        <h2 className="font-mono text-sm text-ink">Network similarity</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Ranks tracked domains by overlap in current CDN, ASN, resolved IPs, health, and latency.
        </p>
      </header>

      <div className="space-y-3">
        {matches.map((match, i) => {
          const pct = Math.round(match.score * 100);
          const { label, tone } = band(match.score);
          return (
            <article
              key={match.domain}
              style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
              className="animate-fade-up card card-hover p-3 sm:p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="min-w-0 truncate font-mono text-sm text-ink">{match.domain}</h3>
                <div className="flex shrink-0 items-baseline gap-2">
                  <span className={`font-mono text-[10px] uppercase tracking-wide ${tone}`}>{label}</span>
                  <span className="font-mono text-sm text-signal">{pct}%</span>
                </div>
              </div>

              <div
                className="mt-3 h-1.5 overflow-hidden rounded bg-line"
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Similarity with ${match.domain}`}
              >
                {/* Width transition makes the bar grow into place on refresh
                    rather than snapping. */}
                <div
                  className="h-full rounded bg-gradient-to-r from-signal/70 to-signal transition-all duration-700 ease-smooth"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Reasons as weighted chips instead of a run-on sentence, so it's
                  visible which signals drove the score and by how much. */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {match.reasons.map((reason) => {
                  const weight = SIGNAL_WEIGHTS[reason];
                  return (
                    <span
                      key={reason}
                      className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                        weight ? "border-line bg-surface2/60 text-ink/70" : "border-line/60 text-muted"
                      }`}
                    >
                      {reason}
                      {weight && <span className="ml-1 text-signal/70">{weight}</span>}
                    </span>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-4 rounded-lg border border-line bg-surface/30 p-3 text-xs leading-relaxed text-muted">
        <span className="font-mono text-signal">What this isn't:</span> shared infrastructure is extremely common —
        millions of unrelated sites sit behind the same CDN. A high score means these domains are hosted alike, not
        that they share an owner, an operator, or any security relationship.
      </p>
    </section>
  );
}
