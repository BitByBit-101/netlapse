import type { ReactNode } from "react";
import type { TlsSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  snapshots: TlsSnapshot[];
}

function daysUntil(dateStr: string): number {
  const diffMs = new Date(dateStr).getTime() - Date.now();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export default function TlsTimeline({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No certificate snapshots yet."
        hint="The collector connects over TLS and records a new entry whenever the certificate is renewed or the negotiated protocol/cipher changes."
      />
    );
  }

  const reversed = [...snapshots].reverse();

  return (
    <div className="space-y-4">
      {reversed.map((snap, i) => {
        const isLatest = i === 0;
        const expiresIn = daysUntil(snap.not_after);
        const expiryTone = expiresIn < 14 ? "text-danger" : expiresIn < 30 ? "text-warn" : "text-muted";

        const rows: { label: string; value: ReactNode; dim?: boolean }[] = [
          { label: "Issuer", value: snap.issuer || "—" },
          { label: "Subject", value: snap.subject || "—" },
          {
            label: "Valid",
            value: (
              <>
                {new Date(snap.not_before).toLocaleDateString()} &rarr; {new Date(snap.not_after).toLocaleDateString()}{" "}
                <span className={expiryTone}>
                  ({expiresIn >= 0 ? `${expiresIn}d left` : `expired ${-expiresIn}d ago`})
                </span>
              </>
            ),
          },
          { label: "TLS", value: `${snap.tls_version} · ${snap.cipher_suite}` },
          { label: "SAN", value: snap.san_records && snap.san_records.length > 0 ? snap.san_records.join(", ") : "—" },
          { label: "Serial", value: snap.serial_number, dim: true },
        ];

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
                  {expiresIn < 30 && (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                        expiresIn < 14 ? "border-danger/40 bg-danger/10 text-danger" : "border-warn/40 bg-warn/10 text-warn"
                      }`}
                    >
                      {expiresIn >= 0 ? "expiring" : "expired"}
                    </span>
                  )}
                  {isLatest && (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-signal">current</span>
                  )}
                </span>
              </div>

              {/* One column below xs — a 90px label gutter left almost nothing
                  for issuer/SAN strings on a phone. */}
              <dl className="mt-2.5 grid grid-cols-1 gap-y-1.5 text-sm xs:grid-cols-[86px_1fr] xs:gap-y-1">
                {rows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="self-start pt-0.5 font-mono text-[11px] uppercase text-muted">{row.label}</dt>
                    <dd className={`break-all font-mono text-xs ${row.dim ? "text-ink/50" : "text-ink/80"}`}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        );
      })}
    </div>
  );
}
