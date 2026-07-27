import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import type { InternetEvent } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  events: InternetEvent[];
}

const TONES: Record<InternetEvent["severity"], { text: string; bg: string; border: string; dot: string }> = {
  critical: { text: "text-danger", bg: "bg-danger/10", border: "border-danger/40", dot: "bg-danger" },
  warning: { text: "text-warn", bg: "bg-warn/10", border: "border-warn/40", dot: "bg-warn" },
  info: { text: "text-signal", bg: "bg-signal/10", border: "border-signal/40", dot: "bg-signal" },
};

const SEVERITIES: InternetEvent["severity"][] = ["critical", "warning", "info"];

/** Playback speeds. The base step is deliberately slow — each step is a whole
 *  event to read, not a frame. */
const SPEEDS = [0.5, 1, 2, 4] as const;
const BASE_STEP_MS = 1900;

/** Columns in the real-time density band. Enough to separate distinct bursts
 *  without turning single events into invisible slivers. */
const DENSITY_BINS = 56;

/** "3 days", "4 hours", "12 min" — the gap between two captures. */
function humanGap(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`;
  const days = hours / 24;
  if (days < 14) return `${days.toFixed(days < 10 ? 1 : 0)} days`;
  return `${Math.round(days / 7)} weeks`;
}

/** Compact absolute stamp for the timeline ends. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ReplayMode({ events }: Props) {
  // The feed arrives newest-first; a replay reads forwards.
  const chronological = useMemo(
    () =>
      [...events].sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()),
    [events]
  );

  const [mutedSources, setMutedSources] = useState<Set<string>>(new Set());
  const [mutedSeverities, setMutedSeverities] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [loop, setLoop] = useState(false);
  /** Drives the entrance animation's direction. */
  const [direction, setDirection] = useState<1 | -1>(1);

  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  /** Remembers which event was on screen so a background refresh doesn't jump. */
  const activeIdRef = useRef<string | null>(null);

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of chronological) counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [chronological]);

  const severityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of chronological) counts.set(event.severity, (counts.get(event.severity) ?? 0) + 1);
    return counts;
  }, [chronological]);

  const timeline = useMemo(
    () =>
      chronological.filter(
        (event) => !mutedSources.has(event.source) && !mutedSeverities.has(event.severity)
      ),
    [chronological, mutedSources, mutedSeverities]
  );

  const count = timeline.length;
  const clamped = Math.min(index, Math.max(count - 1, 0));
  const active = timeline[clamped];

  /**
   * Hold position across refreshes and filter changes by event identity rather
   * than by index.
   *
   * The feed refetches in the background, which produces a brand-new array; the
   * previous version keyed a reset effect on that array and so threw the reader
   * back to the start every time a poll landed. The anchor is recorded when the
   * position is *moved*, not derived from the current render, because an effect
   * reading `active` would already see the post-change value and have nothing
   * left to restore.
   */
  useEffect(() => {
    const id = activeIdRef.current;
    if (id === null) return;
    const found = timeline.findIndex((event) => event.id === id);
    if (found >= 0) {
      setIndex(found);
      return;
    }
    // The anchored event is gone (filtered out, or dropped from the window).
    // Land on the nearest surviving position and re-anchor there, otherwise the
    // stale id would keep failing this lookup forever.
    setIndex((previous) => {
      const next = Math.min(previous, Math.max(timeline.length - 1, 0));
      activeIdRef.current = timeline[next]?.id ?? null;
      return next;
    });
  }, [timeline]);

  const atEnd = count > 0 && clamped >= count - 1;

  // Mirrors of the live values, so `jumpTo` can stay referentially stable.
  // The dashboard refetches every 15s, which produces a new `timeline` array; if
  // `jumpTo` depended on it the playback effect would tear down and rebuild its
  // interval on every poll, restarting the countdown mid-step.
  const indexRef = useRef(0);
  const timelineRef = useRef(timeline);
  useEffect(() => {
    indexRef.current = clamped;
    timelineRef.current = timeline;
  }, [clamped, timeline]);

  const jumpTo = useCallback((target: number) => {
    const list = timelineRef.current;
    const next = Math.max(0, Math.min(target, list.length - 1));
    setDirection(next >= indexRef.current ? 1 : -1);
    setIndex(next);
    activeIdRef.current = list[next]?.id ?? null;
  }, []);

  const step = useCallback((delta: number) => jumpTo(indexRef.current + delta), [jumpTo]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Pressing play at the end restarts, rather than silently wrapping.
    if (atEnd && !loop) jumpTo(0);
    setPlaying(true);
  }, [playing, atEnd, loop, jumpTo]);

  // Playback.
  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = window.setInterval(() => {
      const current = indexRef.current;
      if (current >= count - 1) {
        if (loop) {
          jumpTo(0);
        } else {
          setPlaying(false); // stop at the end instead of looping unasked
        }
        return;
      }
      jumpTo(current + 1);
    }, BASE_STEP_MS / speed);
    return () => window.clearInterval(timer);
  }, [playing, count, speed, loop, jumpTo]);

  // Keyboard transport. Ignored while typing so the domain search box still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          setPlaying(false);
          step(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          setPlaying(false);
          step(-1);
          break;
        case "Home":
          e.preventDefault();
          setPlaying(false);
          jumpTo(0);
          break;
        case "End":
          e.preventDefault();
          setPlaying(false);
          jumpTo(count - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step, jumpTo, count]);

  /**
   * Seek ticks are spaced by INDEX, not by timestamp.
   *
   * Time-proportional spacing is the tempting choice and it fails badly on real
   * data. Measured against this project's own feed (140 events over six days):
   * one quiet stretch would occupy 82% of the track while 135 of 139 adjacent
   * tick pairs collapsed to under 4px apart — because 82 of those gaps are
   * under a minute, so no amount of log or percentile compression separates
   * them. Index spacing keeps every event individually clickable; real elapsed
   * time is carried by the density band and the "+gap" badge instead, which
   * report it without having to double as a hit target.
   */
  const positions = useMemo(
    () => timeline.map((_, i) => (count < 2 ? 0 : i / (count - 1))),
    [timeline, count]
  );

  /**
   * Real-time density: how the same events are distributed across the calendar.
   * This is where clustering shows up — on the sample feed it resolves to two
   * bursts separated by a six-day silence, which the seek track cannot express.
   */
  const density = useMemo(() => {
    if (count < 2) return null;
    const times = timeline.map((event) => new Date(event.captured_at).getTime());
    const first = times[0];
    const span = times[count - 1] - first;
    if (span <= 0) return null; // every event shares a timestamp; nothing to plot
    const bins = new Array<number>(DENSITY_BINS).fill(0);
    const binOf = (time: number) =>
      Math.min(Math.floor(((time - first) / span) * DENSITY_BINS), DENSITY_BINS - 1);
    for (const time of times) bins[binOf(time)] += 1;
    return { bins, peak: Math.max(...bins), activeBin: binOf(times[clamped]) };
  }, [timeline, count, clamped]);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || count === 0) return;
      const box = track.getBoundingClientRect();
      // Inset matches the px-2 padding the ticks are laid out within, so the
      // pointer maps onto the same coordinate space as the markers.
      const inset = 8;
      const usable = Math.max(box.width - inset * 2, 1);
      const fraction = Math.max(0, Math.min(1, (clientX - box.left - inset) / usable));
      jumpTo(Math.round(fraction * (count - 1)));
    },
    [count, jumpTo]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current) seekFromPointer(e.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [seekFromPointer]);

  const toggle = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  if (chronological.length === 0) {
    return (
      <EmptyState
        title="Replay isn't available yet."
        hint="It becomes available after the first material Internet event is recorded."
      />
    );
  }

  const chip = "rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-all active:scale-95";
  const btn =
    "grid h-9 w-9 place-items-center rounded-md border border-line text-muted transition-all hover:border-signal/40 hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-muted";

  const previousEvent = clamped > 0 ? timeline[clamped - 1] : null;
  const nextEvent = clamped < count - 1 ? timeline[clamped + 1] : null;
  const gapFromPrevious = previousEvent && active
    ? new Date(active.captured_at).getTime() - new Date(previousEvent.captured_at).getTime()
    : 0;

  const tone = active ? TONES[active.severity] : TONES.info;
  const fill = count > 0 ? positions[clamped] * 100 : 0;

  return (
    <section className="card p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="font-mono text-sm text-ink">Replay mode</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Step through this domain's recorded history in order. The band shows when activity actually happened; the
            track below it seeks one event at a time.
          </p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted">
          {count === 0 ? "0 / 0" : `${clamped + 1} / ${count}`}
        </span>
      </header>

      {/* Filters. Counts are shown so it's clear what muting a source removes. */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {sourceCounts.map(([source, total]) => {
          const muted = mutedSources.has(source);
          return (
            <button
              key={source}
              type="button"
              aria-pressed={!muted}
              onClick={() => setMutedSources((current) => toggle(current, source))}
              className={`${chip} ${
                muted
                  ? "border-line/60 text-muted/40 line-through"
                  : "border-line bg-surface2/50 text-ink/70 hover:border-signal/40"
              }`}
            >
              {source} <span className="text-muted">{total}</span>
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
        {SEVERITIES.filter((severity) => severityCounts.has(severity)).map((severity) => {
          const muted = mutedSeverities.has(severity);
          return (
            <button
              key={severity}
              type="button"
              aria-pressed={!muted}
              onClick={() => setMutedSeverities((current) => toggle(current, severity))}
              className={`${chip} flex items-center gap-1.5 ${
                muted ? "border-line/60 text-muted/40 line-through" : `${TONES[severity].border} ${TONES[severity].text}`
              }`}
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${muted ? "bg-muted/40" : TONES[severity].dot}`} />
              {severity} <span className="opacity-60">{severityCounts.get(severity)}</span>
            </button>
          );
        })}
      </div>

      {count === 0 ? (
        <div className="mt-6 rounded-lg border border-line bg-surface/30 p-6 text-center">
          <p className="text-sm text-ink/70">Every event is filtered out.</p>
          <button
            type="button"
            onClick={() => {
              setMutedSources(new Set());
              setMutedSeverities(new Set());
            }}
            className="mt-3 rounded-md border border-signal/40 bg-signal/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-signal transition-all hover:bg-signal/20 active:scale-95"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* Active event. The key restarts the entrance so each step reads as a
              move, and the direction reflects which way we travelled. */}
          <div
            key={active.id}
            className={`mt-5 rounded-lg border border-line bg-surface/30 p-4 ${
              direction === 1 ? "animate-slide-next" : "animate-slide-prev"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone.border} ${tone.bg} ${tone.text}`}>
                {active.source}
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${tone.text}`}>{active.severity}</span>
              <span aria-hidden="true" className="h-3 w-px bg-line" />
              <time className="font-mono text-[11px] text-muted" dateTime={active.captured_at}>
                {new Date(active.captured_at).toLocaleString()}
              </time>
              {gapFromPrevious > 0 && (
                <span className="rounded bg-surface2/60 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  +{humanGap(gapFromPrevious)}
                </span>
              )}
            </div>

            <h3 className="mt-3 break-words text-base leading-snug text-ink sm:text-lg">{active.title}</h3>
            <p className="mt-2 text-sm leading-6 text-ink/75">{active.summary}</p>
          </div>

          {/* Neighbours: knowing what's on either side turns a slideshow into a
              narrative you can follow. */}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[
              { label: "previous", event: previousEvent, delta: -1 },
              { label: "next", event: nextEvent, delta: 1 },
            ].map(({ label, event, delta }) => (
              <button
                key={label}
                type="button"
                disabled={!event}
                onClick={() => {
                  setPlaying(false);
                  step(delta);
                }}
                className="group flex min-w-0 items-center gap-2 rounded-md border border-line/60 bg-void px-2.5 py-2 text-left transition-colors hover:border-line disabled:opacity-30 disabled:hover:border-line/60"
              >
                {delta < 0 && <ChevronLeft size={12} className="shrink-0 text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-muted">{label}</span>
                  <span className="block truncate text-[11px] text-ink/60 group-hover:text-ink/80">
                    {event ? event.title : "—"}
                  </span>
                </span>
                {delta > 0 && <ChevronRight size={12} className="shrink-0 text-muted" />}
              </button>
            ))}
          </div>

          {/* Real-time density. Separate from the seek track on purpose: this
              axis is the calendar, so a quiet week reads as empty space and a
              burst reads as a spike. */}
          {density && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-baseline justify-between font-mono text-[10px] text-muted">
                <span>{shortDate(timeline[0].captured_at)}</span>
                <span className="text-muted/60">activity over time</span>
                <span>{shortDate(timeline[count - 1].captured_at)}</span>
              </div>
              <div
                aria-hidden="true"
                className="flex h-8 items-end gap-px overflow-hidden rounded-md border border-line bg-void px-1 pb-1 pt-1"
              >
                {density.bins.map((total, i) => (
                  <span
                    key={i}
                    className={`flex-1 rounded-sm transition-colors duration-200 ${
                      i === density.activeBin ? "bg-signal" : total > 0 ? "bg-signal/25" : "bg-line/40"
                    }`}
                    // A single event still gets a visible stub; empty bins keep a
                    // hairline so the axis stays readable as a continuous span.
                    style={{ height: total > 0 ? `${Math.max((total / density.peak) * 100, 14)}%` : "2px" }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Seek track, spaced one slot per event. role=slider so it's a real
              control for keyboard and assistive tech, not a decorative bar. */}
          <div className="mt-2">
            <div
              ref={trackRef}
              role="slider"
              tabIndex={0}
              aria-label="Replay position"
              aria-valuemin={1}
              aria-valuemax={count}
              aria-valuenow={clamped + 1}
              aria-valuetext={`${active.source} — ${active.title}, ${new Date(active.captured_at).toLocaleString()}`}
              onPointerDown={(e) => {
                draggingRef.current = true;
                setPlaying(false);
                seekFromPointer(e.clientX);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
                  // Handled by the window listener; stop the track scrolling too.
                  e.preventDefault();
                }
              }}
              className="group relative h-9 cursor-pointer touch-none rounded-md border border-line bg-void px-2 focus:outline-none focus-visible:border-signal/50"
            >
              {/* Rail */}
              <div aria-hidden="true" className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 rounded bg-line" />
              <div
                aria-hidden="true"
                className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-signal/50 transition-[width] duration-300 ease-smooth"
                style={{ left: "0.5rem", width: `calc((100% - 1rem) * ${fill / 100})` }}
              />

              {/* One severity-coloured bar per event. Bars rather than dots
                  because they tile cleanly at any count — 140 dots on a 760px
                  track would overlap into a smear. */}
              {timeline.map((event, i) => (
                <span
                  key={event.id}
                  aria-hidden="true"
                  title={`${event.source}: ${event.title}`}
                  style={{ left: `calc(0.5rem + (100% - 1rem) * ${positions[i]})` }}
                  className={`absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200 ${
                    TONES[event.severity].dot
                  } ${i === clamped ? "h-4 opacity-0" : i < clamped ? "h-2.5 opacity-80" : "h-2 opacity-30"}`}
                />
              ))}

              {/* Playhead. Its own element so it slides between positions
                  instead of one tick popping to a larger size. */}
              <span
                aria-hidden="true"
                style={{ left: `calc(0.5rem + (100% - 1rem) * ${positions[clamped]})` }}
                className={`absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-void transition-[left] duration-300 ease-smooth ${tone.dot}`}
              />
            </div>
          </div>

          {/* Transport */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="First event (Home)"
                aria-label="First event"
                disabled={clamped === 0}
                onClick={() => {
                  setPlaying(false);
                  jumpTo(0);
                }}
                className={btn}
              >
                <SkipBack size={13} />
              </button>
              <button
                type="button"
                title="Previous event (←)"
                aria-label="Previous event"
                disabled={clamped === 0}
                onClick={() => {
                  setPlaying(false);
                  step(-1);
                }}
                className={btn}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                title={playing ? "Pause (space)" : atEnd && !loop ? "Replay from start (space)" : "Play (space)"}
                aria-label={playing ? "Pause replay" : "Play replay"}
                onClick={togglePlay}
                disabled={count < 2}
                className="flex h-9 items-center gap-2 rounded-md border border-signal/40 bg-signal/10 px-4 font-mono text-xs text-signal transition-all hover:bg-signal/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {playing ? <Pause size={13} /> : atEnd && !loop ? <RotateCcw size={13} /> : <Play size={13} />}
                {playing ? "Pause" : atEnd && !loop ? "Replay" : "Play"}
              </button>
              <button
                type="button"
                title="Next event (→)"
                aria-label="Next event"
                disabled={atEnd}
                onClick={() => {
                  setPlaying(false);
                  step(1);
                }}
                className={btn}
              >
                <ChevronRight size={15} />
              </button>
              <button
                type="button"
                title="Latest event (End)"
                aria-label="Latest event"
                disabled={atEnd}
                onClick={() => {
                  setPlaying(false);
                  jumpTo(count - 1);
                }}
                className={btn}
              >
                <SkipForward size={13} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              {/* Speed. Only meaningful while stepping automatically. */}
              <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
                {SPEEDS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={speed === option}
                    onClick={() => setSpeed(option)}
                    className={`rounded px-1.5 py-1 font-mono text-[10px] transition-colors ${
                      speed === option ? "bg-signal/15 text-signal" : "text-muted hover:text-ink"
                    }`}
                  >
                    {option}×
                  </button>
                ))}
              </div>

              <button
                type="button"
                aria-pressed={loop}
                onClick={() => setLoop((current) => !current)}
                title="Restart automatically at the end"
                className={`${chip} ${loop ? "border-signal/40 bg-signal/10 text-signal" : "border-line text-muted hover:text-ink"}`}
              >
                loop
              </button>

              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-muted">
                {playing && <span aria-hidden="true" className={`h-1.5 w-1.5 animate-pulse-soft rounded-full ${tone.dot}`} />}
                {playing ? "replaying" : atEnd ? "at latest" : "paused"}
              </span>
            </div>
          </div>

          <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted/60">
            space plays · ← → steps · home / end jumps to either end
          </p>
        </>
      )}
    </section>
  );
}
