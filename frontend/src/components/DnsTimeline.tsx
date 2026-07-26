import type { DnsSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  snapshots: DnsSnapshot[];
}

const FIELDS: { key: keyof DnsSnapshot; label: string }[] = [
  { key: "a_records", label: "A" },
  { key: "aaaa_records", label: "AAAA" },
  { key: "cname", label: "CNAME" },
  { key: "ns_records", label: "NS" },
  { key: "mx_records", label: "MX" },
  { key: "txt_records", label: "TXT" },
];

function fmt(v: string[] | string | null): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return v || "—";
}

function changed(prev: DnsSnapshot | undefined, cur: DnsSnapshot, key: keyof DnsSnapshot) {
  if (!prev) return false;
  return JSON.stringify(prev[key]) !== JSON.stringify(cur[key]);
}

export default function DnsTimeline({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No DNS snapshots recorded yet."
        hint="The collector runs on an interval — check back after it ticks, or restart the backend to force an immediate capture."
      />
    );
  }

  // Newest first for reading, but diffs are computed against the chronologically previous snapshot.
  const chronological = snapshots;
  const reversed = [...snapshots].reverse();

  return (
    <div className="space-y-4">
      {reversed.map((snap, i) => {
        const idxInChron = chronological.length - 1 - i;
        const prev = chronological[idxInChron - 1];
        const isLatest = i === 0;
        const changeCount = FIELDS.filter(({ key }) => changed(prev, snap, key)).length;

        return (
          <div
            key={snap.id}
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
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-mono text-[11px] text-signal sm:text-xs">
                  {new Date(snap.captured_at).toLocaleString()}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {changeCount > 0 && (
                    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-warn">
                      {changeCount} changed
                    </span>
                  )}
                  {isLatest && (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-signal">current</span>
                  )}
                </span>
              </div>

              {/* Stacks to one column on the narrowest screens: a fixed 70px
                  label gutter leaves too little room for long TXT values. */}
              <dl className="mt-2.5 grid grid-cols-1 gap-y-1.5 text-sm xs:grid-cols-[68px_1fr] xs:gap-y-1">
                {FIELDS.map(({ key, label }) => {
                  const isChanged = changed(prev, snap, key);
                  return (
                    <div key={key} className="contents">
                      <dt className="self-start pt-0.5 font-mono text-[11px] uppercase text-muted">{label}</dt>
                      <dd
                        className={`break-all font-mono text-xs transition-colors ${
                          isChanged ? "-mx-1 rounded bg-warn/10 px-1 text-warn" : "text-ink/80"
                        }`}
                      >
                        {fmt(snap[key] as string[] | string | null)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </div>
        );
      })}
    </div>
  );
}
