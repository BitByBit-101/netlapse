import type { InvestigationReport } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  report: InvestigationReport | null;
}

const TONES = {
  critical: "border-danger/50 bg-danger/10 text-danger",
  warning: "border-warn/50 bg-warn/10 text-warn",
  info: "border-signal/40 bg-signal/10 text-signal",
  healthy: "border-signal/40 bg-signal/10 text-signal",
} as const;

export default function InvestigatorReport({ report }: Props) {
  if (!report) {
    return (
      <EmptyState
        title="No investigation available."
        hint="A report is generated from the latest collected signals for this domain."
      />
    );
  }

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="font-mono text-sm text-ink">Investigator report</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Evidence-linked analysis across availability, route, BGP, and TLS signals.
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <time className="block font-mono text-[11px] text-muted">
            {new Date(report.generated_at).toLocaleTimeString()}
          </time>
          <span className={`font-mono text-[10px] ${report.llm_status === "ready" ? "text-signal" : "text-muted"}`}>
            {report.llm_status === "ready" ? report.llm_model : "local evidence"}
          </span>
        </div>
      </header>

      {report.narrative && (
        <div className="animate-fade-up mb-4 rounded-lg border border-signal/30 bg-signal/5 p-3 shadow-glow sm:p-4">
          <p className="font-mono text-[10px] uppercase text-signal">Model summary</p>
          <p className="mt-2 text-sm leading-6 text-ink/85">{report.narrative}</p>
        </div>
      )}

      <div className="space-y-3">
        {report.findings.map((finding, index) => (
          <article
            key={`${finding.title}-${index}`}
            style={{ animationDelay: `${Math.min(index * 60, 300)}ms` }}
            className="animate-fade-up card card-hover p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
              <h3 className="min-w-0 font-mono text-sm text-ink">{finding.title}</h3>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                  TONES[finding.severity]
                }`}
              >
                {finding.severity}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink/80">{finding.summary}</p>
            <div className="mt-3 border-l-2 border-line pl-3">
              <p className="font-mono text-[10px] uppercase text-muted">Evidence</p>
              <p className="mt-1 break-words font-mono text-xs leading-relaxed text-ink/70">{finding.evidence}</p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              <span className="font-mono text-signal">Next:</span> {finding.action}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
