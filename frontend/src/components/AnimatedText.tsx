import { useEffect, useState } from "react";

/**
 * Entrance animations for headline copy.
 *
 * Everything is a pure CSS transform/opacity animation over a stable DOM —
 * nothing re-renders per frame and no text is ever substituted, so the motion
 * stays composited and smooth. Both components collapse to plain, fully-rendered
 * text under `prefers-reduced-motion`.
 *
 * Callers should put the real sentence in an `aria-label` on the wrapper and
 * mark the animated markup `aria-hidden`: text split across a span per character
 * reads terribly aloud.
 */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Split into words, keeping whitespace as its own entries so the text still
 *  wraps naturally and copy-pastes as the original sentence. */
function toParts(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part !== "");
}

interface CharRevealProps {
  text: string;
  /** ms before the first character starts moving. */
  delay?: number;
  /** ms between consecutive characters. */
  stagger?: number;
  className?: string;
}

/**
 * Characters swing up into place around their own baseline, in 3D.
 *
 * Each word is its own inline-block with its own perspective, so lines still
 * break between words and the rotation reads per-word rather than as one long
 * skewed strip. The stagger is what carries the eye across the line.
 */
export function CharReveal({ text, delay = 0, stagger = 26, className = "" }: CharRevealProps) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <span className={className}>{text}</span>;

  let charIndex = 0;
  return (
    <span className={className}>
      {toParts(text).map((part, partIndex) => {
        if (/^\s+$/.test(part)) return <span key={partIndex}>{part}</span>;
        return (
          <span key={partIndex} className="inline-block [perspective:700px]">
            {Array.from(part).map((char, i) => {
              const style = { animationDelay: `${delay + charIndex * stagger}ms` };
              charIndex++;
              return (
                <span
                  key={i}
                  style={style}
                  className="animate-char-in inline-block origin-bottom will-change-transform"
                >
                  {char}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
}

export interface TextSegment {
  text: string;
  /** Arrives tinted and settles to body colour. */
  highlight?: boolean;
}

interface WordRevealProps {
  segments: (TextSegment | string)[];
  delay?: number;
  stagger?: number;
  className?: string;
}

/**
 * Body copy popping up word by word — a real rise and a slight scale-up, so it
 * carries some of the headline's energy without going per-character, which at
 * paragraph length would read as chaos.
 */
export function WordReveal({ segments, delay = 0, stagger = 30, className = "" }: WordRevealProps) {
  const reduced = usePrefersReducedMotion();
  const normalised: TextSegment[] = segments.map((segment) =>
    typeof segment === "string" ? { text: segment } : segment
  );

  if (reduced) {
    return (
      <span className={className}>
        {normalised.map((segment, i) => (
          <span key={i} className={segment.highlight ? "font-medium text-ink" : undefined}>
            {segment.text}
          </span>
        ))}
      </span>
    );
  }

  // Counted across segments, not per segment, so the stagger stays continuous
  // through a highlighted phrase.
  let wordIndex = 0;
  return (
    <span className={className}>
      {normalised.map((segment, segmentIndex) =>
        toParts(segment.text).map((part, partIndex) => {
          const partKey = `${segmentIndex}-${partIndex}`;
          if (/^\s+$/.test(part)) return <span key={partKey}>{part}</span>;
          const style = { animationDelay: `${delay + wordIndex * stagger}ms` };
          wordIndex++;
          return (
            <span
              key={partKey}
              style={style}
              className={
                segment.highlight
                  ? "animate-word-pop-tint inline-block font-medium will-change-transform"
                  : "animate-word-pop inline-block will-change-transform"
              }
            >
              {part}
            </span>
          );
        })
      )}
    </span>
  );
}

interface UnderlineProps {
  /** ms before the rule starts sweeping out. */
  delay?: number;
}

/**
 * A rule that sweeps out from the start of a line, with a packet of light
 * running along it afterwards — on-brand for a network tool, and it keeps the
 * headline alive after the entrance finishes instead of going static.
 */
export function PacketUnderline({ delay = 0 }: UnderlineProps) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return null;

  return (
    <span aria-hidden="true" className="absolute -bottom-1 left-0 h-px w-full">
      <span
        className="animate-rule-in absolute inset-0 origin-left bg-signal/40"
        style={{ animationDelay: `${delay}ms` }}
      />
      {/* Full-width carrier: the packet rides it, so translateX(100%) on the
          carrier spans the rule rather than the dot's own 6px. */}
      <span
        className="animate-packet-run absolute inset-0 will-change-transform"
        style={{ animationDelay: `${delay + 620}ms` }}
      >
        <span className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal shadow-glow" />
      </span>
    </span>
  );
}
