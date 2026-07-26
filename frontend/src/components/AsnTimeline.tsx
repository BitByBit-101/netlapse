import type { AsnSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  snapshots: AsnSnapshot[];
}

export default function AsnTimeline({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No ASN data yet."
        hint="This looks up each IP's owning network via DNS (Team Cymru's whois service) — check back after the collector ticks."
      />
    );
  }

  const reversed = [...snapshots].reverse();

  return (
    <div className="space-y-4">
      {reversed.map((snap, i) => {
        const isLatest = i === 0;
        return (
          <div
            key={snap.captured_at}
            style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
            className="animate-fade-up relative pl-6"
          >
            <div
              className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border transition-colors ${
                isLatest ? "border-signal bg-signal shadow-glow" : "border-muted bg-surface2"
              }`}
            />
            {i < reversed.length - 1 && <div className="absolute bottom-[-1rem] left-[4.5px] top-4 w-px bg-line" />}
            <div className="card card-hover px-3 py-3 sm:px-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-signal sm:text-xs">
                  {new Date(snap.captured_at).toLocaleString()}
                </span>
                {isLatest && (
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-signal">current</span>
                )}
              </div>

              {/* A 4-column table can't shrink below its content, so let it
                  scroll inside the card rather than overflow it on a phone. */}
              <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[380px] font-mono text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="pb-1 pr-3 font-normal">IP</th>
                      <th className="pb-1 pr-3 font-normal">ASN</th>
                      <th className="pb-1 pr-3 font-normal">Organization</th>
                      <th className="pb-1 font-normal">Country</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.entries.map((e) => (
                      <tr key={e.ip} className="border-t border-line/60 transition-colors hover:bg-surface2/40">
                        <td className="py-1.5 pr-3 text-ink/80">{e.ip}</td>
                        <td className="py-1.5 pr-3 text-ink/80">AS{e.asn || "?"}</td>
                        <td className="max-w-[160px] truncate py-1.5 pr-3 text-ink/80" title={e.as_name}>
                          {e.as_name || "—"}
                        </td>
                        <td className="py-1.5 text-ink/80">{e.country || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
