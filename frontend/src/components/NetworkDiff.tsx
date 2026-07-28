import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Minus, Plus } from "lucide-react";
import type { CdnSnapshot, DnsSnapshot, TlsSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  dnsSnapshots: DnsSnapshot[];
  cdnSnapshots: CdnSnapshot[];
  tlsSnapshots: TlsSnapshot[];
}

/** A single comparable property of the network state. */
interface Field {
  group: "DNS" | "CDN" | "TLS";
  label: string;
  /** Multi-valued fields diff as sets (added / removed); the rest compare as text. */
  kind: "set" | "value";
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
  changed: boolean;
  /** No capture existed on one side, so "changed" would be a lie. */
  incomparable: boolean;
}

const GROUP_TONES: Record<Field["group"], string> = {
  DNS: "border-signal/30 bg-signal/10 text-signal",
  CDN: "border-warn/30 bg-warn/10 text-warn",
  TLS: "border-danger/30 bg-danger/10 text-danger",
};

function ts(iso: string): number {
  return new Date(iso).getTime();
}

/** Most recent snapshot at or before `instant`, or undefined if none exists yet.
 *  Inputs arrive ascending from the API. */
function asOf<T extends { captured_at: string }>(snapshots: T[], instant: string): T | undefined {
  const limit = ts(instant);
  let found: T | undefined;
  for (const snapshot of snapshots) {
    if (ts(snapshot.captured_at) <= limit) found = snapshot;
    else break;
  }
  return found;
}

function list(values: string[] | null | undefined): string[] {
  return [...(values ?? [])].filter((value) => value.trim() !== "").sort();
}

function one(value: string | undefined | null): string[] {
  const trimmed = value?.trim();
  return trimmed ? [trimmed] : [];
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function humanGap(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = abs / 3600000;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)} days`;
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Build one field per comparable property.
 *
 * Values are compared by CONTENT. The previous version compared DNS by record
 * *count* only, which on this project's own data reported "no change" for 33 of
 * 44 consecutive google.com captures — including an A record moving from
 * 142.250.205.78 to 172.217.24.174. A rotation swaps one address for another and
 * leaves the count identical, so counting cannot see the change that matters.
 */
function buildFields(
  before: { dns?: DnsSnapshot; cdn?: CdnSnapshot; tls?: TlsSnapshot },
  after: { dns?: DnsSnapshot; cdn?: CdnSnapshot; tls?: TlsSnapshot }
): Field[] {
  const definitions: Array<{
    group: Field["group"];
    label: string;
    kind: Field["kind"];
    present: [boolean, boolean];
    before: string[];
    after: string[];
  }> = [
    ...(
      [
        ["A", (s?: DnsSnapshot) => list(s?.a_records)],
        ["AAAA", (s?: DnsSnapshot) => list(s?.aaaa_records)],
        ["CNAME", (s?: DnsSnapshot) => one(s?.cname)],
        ["NS", (s?: DnsSnapshot) => list(s?.ns_records)],
        ["MX", (s?: DnsSnapshot) => list(s?.mx_records)],
        ["TXT", (s?: DnsSnapshot) => list(s?.txt_records)],
      ] as const
    ).map(([label, pick]) => ({
      group: "DNS" as const,
      label,
      kind: "set" as const,
      present: [Boolean(before.dns), Boolean(after.dns)] as [boolean, boolean],
      before: pick(before.dns),
      after: pick(after.dns),
    })),
    ...(
      [
        ["Provider", (s?: CdnSnapshot) => one(s?.provider)],
        ["Detected via", (s?: CdnSnapshot) => one(s?.detected_via)],
        ["Evidence", (s?: CdnSnapshot) => one(s?.evidence)],
      ] as const
    ).map(([label, pick]) => ({
      group: "CDN" as const,
      label,
      kind: "value" as const,
      present: [Boolean(before.cdn), Boolean(after.cdn)] as [boolean, boolean],
      before: pick(before.cdn),
      after: pick(after.cdn),
    })),
    ...(
      [
        ["Issuer", "value", (s?: TlsSnapshot) => one(s?.issuer)],
        ["Serial", "value", (s?: TlsSnapshot) => one(s?.serial_number)],
        ["TLS version", "value", (s?: TlsSnapshot) => one(s?.tls_version)],
        ["Cipher", "value", (s?: TlsSnapshot) => one(s?.cipher_suite)],
        ["Expires", "value", (s?: TlsSnapshot) => one(s?.not_after)],
        ["SAN", "set", (s?: TlsSnapshot) => list(s?.san_records)],
      ] as const
    ).map(([label, kind, pick]) => ({
      group: "TLS" as const,
      label,
      kind: kind as Field["kind"],
      present: [Boolean(before.tls), Boolean(after.tls)] as [boolean, boolean],
      before: pick(before.tls),
      after: pick(after.tls),
    })),
  ];

  return definitions.map((definition) => {
    const incomparable = !definition.present[0] || !definition.present[1];
    const changed = !incomparable && !sameSet(definition.before, definition.after);
    return {
      group: definition.group,
      label: definition.label,
      kind: definition.kind,
      before: definition.before,
      after: definition.after,
      added: changed ? definition.after.filter((value) => !definition.before.includes(value)) : [],
      removed: changed ? definition.before.filter((value) => !definition.after.includes(value)) : [],
      changed,
      incomparable,
    };
  });
}

export default function NetworkDiff({ dnsSnapshots, cdnSnapshots, tlsSnapshots }: Props) {
  /**
   * Every distinct instant at which anything was captured.
   *
   * The three collectors run on independent tickers, so "the last two snapshots
   * of each stream" is not a pair of coherent moments. On live data that put a
   * DNS capture from Jul 30 in the same "Old" column as a CDN capture from Jul 24
   * — six days apart, presented as one before-state. Comparing two *instants*
   * and resolving each stream as-of those instants fixes that.
   */
  const instants = useMemo(() => {
    const all = new Set<string>();
    for (const snapshot of [...dnsSnapshots, ...cdnSnapshots, ...tlsSnapshots]) all.add(snapshot.captured_at);
    return [...all].sort((a, b) => ts(a) - ts(b));
  }, [dnsSnapshots, cdnSnapshots, tlsSnapshots]);

  const total = instants.length;
  const [pair, setPair] = useState<[number, number]>([Math.max(total - 2, 0), Math.max(total - 1, 0)]);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [copied, setCopied] = useState(false);
  /** The newest instant this component has already reacted to. */
  const newestSeen = useRef<string | undefined>(instants[total - 1]);
  const pairRef = useRef(pair);
  useEffect(() => {
    pairRef.current = pair;
  }, [pair]);

  /**
   * The dashboard refetches every 15s. Follow new captures only while the view
   * is pinned to the newest pair; if the reader has selected an older
   * comparison, leave it alone.
   *
   * The test is by instant identity, not by index: comparing indices breaks when
   * more than one capture lands between polls (three collectors on independent
   * tickers make that ordinary). New instants only ever append to the sorted
   * array, so an existing index keeps pointing at the same instant.
   */
  useEffect(() => {
    const newest = instants[instants.length - 1];
    if (newest === newestSeen.current) return;
    const previousNewest = newestSeen.current;
    newestSeen.current = newest;
    const [, to] = pairRef.current;
    const wasAtLatest = previousNewest === undefined || instants[to] === previousNewest;
    if (wasAtLatest) setPair([Math.max(instants.length - 2, 0), Math.max(instants.length - 1, 0)]);
  }, [instants]);

  const [fromIndex, toIndex] = [
    Math.min(pair[0], Math.max(total - 1, 0)),
    Math.min(pair[1], Math.max(total - 1, 0)),
  ];
  const fromInstant = instants[fromIndex];
  const toInstant = instants[toIndex];

  // "before" may never overtake "after". Pushing one end past the other drags
  // the other along instead of silently inverting the comparison.
  const setFrom = (next: number) => {
    const clamped = Math.max(0, Math.min(next, total - 1));
    setPair(([, to]) => [clamped, Math.max(clamped, to)]);
  };
  const setTo = (next: number) => {
    const clamped = Math.max(0, Math.min(next, total - 1));
    setPair(([from]) => [Math.min(from, clamped), clamped]);
  };

  const fields = useMemo(() => {
    if (!fromInstant || !toInstant) return [];
    return buildFields(
      {
        dns: asOf(dnsSnapshots, fromInstant),
        cdn: asOf(cdnSnapshots, fromInstant),
        tls: asOf(tlsSnapshots, fromInstant),
      },
      {
        dns: asOf(dnsSnapshots, toInstant),
        cdn: asOf(cdnSnapshots, toInstant),
        tls: asOf(tlsSnapshots, toInstant),
      }
    );
  }, [dnsSnapshots, cdnSnapshots, tlsSnapshots, fromInstant, toInstant]);

  const changed = fields.filter((field) => field.changed);
  const visible = showUnchanged ? fields : changed;

  /** Which stream actually has a distinct capture at each end — this is what
   *  makes the comparison honest about whose data moved. */
  const provenance = useMemo(() => {
    if (!fromInstant || !toInstant) return [];
    return (
      [
        ["DNS", dnsSnapshots],
        ["CDN", cdnSnapshots],
        ["TLS", tlsSnapshots],
      ] as const
    ).map(([group, snapshots]) => {
      const before = asOf(snapshots as { captured_at: string }[], fromInstant);
      const after = asOf(snapshots as { captured_at: string }[], toInstant);
      return {
        group,
        before: before?.captured_at,
        after: after?.captured_at,
        stale: Boolean(before && after && before.captured_at === after.captured_at),
      };
    });
  }, [dnsSnapshots, cdnSnapshots, tlsSnapshots, fromInstant, toInstant]);

  const copySummary = async () => {
    const lines = [
      `netlapse diff`,
      `from ${stamp(fromInstant)}`,
      `to   ${stamp(toInstant)}`,
      "",
      ...(changed.length === 0
        ? ["No changes between these captures."]
        : changed.map((field) => {
            const label = `${field.group} ${field.label}`;
            if (field.kind === "value") {
              return `${label}: ${field.before.join(", ") || "—"} -> ${field.after.join(", ") || "—"}`;
            }
            const parts = [
              ...field.added.map((value) => `+${value}`),
              ...field.removed.map((value) => `-${value}`),
            ];
            return `${label}: ${parts.join(" ")}`;
          })),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false); // clipboard blocked (insecure origin or denied permission)
    }
  };

  if (total === 0) {
    return (
      <EmptyState
        title="Nothing captured yet."
        hint="A diff needs at least one DNS, CDN, or TLS snapshot."
      />
    );
  }

  if (total === 1) {
    return (
      <EmptyState
        title="Only one capture so far."
        hint={`A diff needs a second capture to compare against. The first was recorded ${stamp(instants[0])}.`}
      />
    );
  }

  const gap = ts(toInstant) - ts(fromInstant);
  const chip = "rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-all active:scale-95";

  return (
    <section className="card p-3 sm:p-4">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="font-mono text-sm text-ink">Network diff</h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
            Compares the full recorded state at two moments, field by field. Each stream is resolved as of the chosen
            instant, so a slow-ticking collector isn't misread as having changed.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
              changed.length > 0 ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-surface2 text-muted"
            }`}
          >
            {changed.length > 0 ? `${changed.length} changed` : "no change"}
          </span>
          <button
            type="button"
            onClick={copySummary}
            title="Copy this diff as text"
            className={`${chip} flex items-center gap-1.5 border-line text-muted hover:border-signal/40 hover:text-ink`}
          >
            {copied ? <Check size={11} className="text-signal" /> : <Copy size={11} />}
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </header>

      {/* Instant selection. Stepping either end independently is the point —
          comparing today against last week is a different question from
          comparing two consecutive captures. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <InstantPicker
          side="from"
          index={fromIndex}
          total={total}
          instant={fromInstant}
          onStep={(delta) => setFrom(fromIndex + delta)}
          onSet={setFrom}
        />
        <div className="flex items-center justify-center gap-2 py-1 sm:flex-col sm:py-0">
          <ArrowRight size={14} className="text-muted sm:rotate-0" aria-hidden="true" />
          <span className="font-mono text-[10px] text-muted">{humanGap(gap)}</span>
        </div>
        <InstantPicker
          side="to"
          index={toIndex}
          total={total}
          instant={toInstant}
          onStep={(delta) => setTo(toIndex + delta)}
          onSet={setTo}
        />
      </div>

      {/* Provenance: which collector actually moved between these instants. A
          stream whose snapshot is identical on both sides is called out rather
          than quietly rendered as unchanged data. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {provenance.map((entry) => (
          <span
            key={entry.group}
            title={
              entry.before === undefined
                ? `No ${entry.group} capture existed at the start of this range`
                : entry.stale
                  ? `${entry.group} did not re-capture in this range; the same snapshot is on both sides`
                  : `${entry.group}: ${stamp(entry.before)} → ${stamp(entry.after!)}`
            }
            className={`${chip} flex items-center gap-1.5 ${
              entry.before === undefined
                ? "border-line/60 text-muted/50"
                : entry.stale
                  ? "border-line text-muted"
                  : `${GROUP_TONES[entry.group]}`
            }`}
          >
            {entry.group}
            <span className="normal-case opacity-70">
              {entry.before === undefined ? "no baseline" : entry.stale ? "same capture" : "re-captured"}
            </span>
          </span>
        ))}
        <button
          type="button"
          aria-pressed={showUnchanged}
          onClick={() => setShowUnchanged((current) => !current)}
          className={`${chip} ml-auto ${
            showUnchanged ? "border-signal/40 bg-signal/10 text-signal" : "border-line text-muted hover:text-ink"
          }`}
        >
          {showUnchanged ? "hiding nothing" : `show all ${fields.length}`}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-line/70 bg-surface/20 px-4 py-6 text-center">
          <p className="text-sm text-ink/70">Nothing changed between these two captures.</p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted">
            Every recorded field is identical. Widen the range or turn on "show all" to see the values that held steady.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((field, i) => (
            <li
              key={`${field.group}-${field.label}`}
              className="animate-fade-up"
              style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
            >
              <FieldRow field={field} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InstantPicker({
  side,
  index,
  total,
  instant,
  onStep,
  onSet,
}: {
  side: "from" | "to";
  index: number;
  total: number;
  instant: string;
  onStep: (delta: number) => void;
  onSet: (index: number) => void;
}) {
  const nav =
    "grid h-7 w-7 shrink-0 place-items-center rounded border border-line text-muted transition-all hover:border-signal/40 hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted";
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        side === "to" ? "border-signal/30 bg-signal/5" : "border-line bg-surface2/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono text-[10px] uppercase ${side === "to" ? "text-signal" : "text-muted"}`}>
          {side === "to" ? "after" : "before"}
        </span>
        <span className="font-mono text-[10px] text-muted">
          {index + 1} / {total}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          className={nav}
          aria-label={`Earlier ${side} capture`}
          disabled={index <= 0}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft size={13} />
        </button>
        <input
          type="range"
          min={0}
          max={total - 1}
          value={index}
          aria-label={`${side === "to" ? "After" : "Before"} capture`}
          onChange={(e) => onSet(Number(e.target.value))}
          className="min-w-0 flex-1 accent-signal"
        />
        <button
          type="button"
          className={nav}
          aria-label={`Later ${side} capture`}
          disabled={index >= total - 1}
          onClick={() => onStep(1)}
        >
          <ChevronRight size={13} />
        </button>
      </div>
      <time className="mt-1.5 block font-mono text-[11px] text-ink/70" dateTime={instant}>
        {stamp(instant)}
      </time>
    </div>
  );
}

/** Values shown per side before a set diff collapses. */
const VALUE_CAP = 4;

function FieldRow({ field }: { field: Field }) {
  const [expanded, setExpanded] = useState(false);
  const unchanged = !field.changed;
  const shown = expanded
    ? { removed: field.removed, added: field.added }
    : { removed: field.removed.slice(0, VALUE_CAP), added: field.added.slice(0, VALUE_CAP) };
  const hidden =
    field.removed.length - shown.removed.length + (field.added.length - shown.added.length);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        field.changed ? "border-warn/30 bg-warn/[0.04]" : "border-line bg-surface2/20"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${GROUP_TONES[field.group]}`}>
          {field.group}
        </span>
        <span className="font-mono text-xs text-ink">{field.label}</span>
        {field.incomparable && (
          <span className="font-mono text-[10px] uppercase text-muted" title="One side has no capture to compare">
            no baseline
          </span>
        )}
      </div>

      {unchanged ? (
        <p className="mt-2 break-words font-mono text-[11px] text-muted">
          {field.after.length > 0 ? field.after.join(", ") : "not recorded"}
        </p>
      ) : field.kind === "value" ? (
        // Single-valued: the old → new transition reads better than +/- lines.
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="break-all text-danger/80 line-through decoration-danger/40">
            {field.before.join(", ") || "not recorded"}
          </span>
          <ArrowRight size={11} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="break-all text-signal">{field.after.join(", ") || "not recorded"}</span>
        </div>
      ) : (
        // Multi-valued: show precisely which entries arrived and which left, so a
        // rotation that keeps the count identical is still fully visible.
        <div className="mt-2 space-y-1">
          {shown.removed.map((value) => (
            <p key={`-${value}`} className="flex items-start gap-1.5 font-mono text-[11px] text-danger/85">
              <Minus size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="break-all">{value}</span>
            </p>
          ))}
          {shown.added.map((value) => (
            <p key={`+${value}`} className="flex items-start gap-1.5 font-mono text-[11px] text-signal">
              <Plus size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="break-all">{value}</span>
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
            {field.before.length > 0 && field.after.length > 0 && (
              <p className="font-mono text-[10px] text-muted">
                {field.before.length} → {field.after.length} value{field.after.length === 1 ? "" : "s"}
              </p>
            )}
            {/* A TXT rewrite can move 22 values at once, some 300+ chars long.
                Collapsed by default so one noisy field can't bury the rest. */}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="font-mono text-[10px] uppercase tracking-wider text-signal/80 transition-colors hover:text-signal"
              >
                {expanded ? "show less" : `+${hidden} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
