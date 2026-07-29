import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveals children on first scroll into view.
 *
 * Uses IntersectionObserver rather than scroll listeners so it costs nothing
 * per frame, and unobserves after firing so elements never re-animate. If the
 * user prefers reduced motion we render visible immediately and skip the
 * observer entirely.
 */
export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(Boolean(reduced));

  useEffect(() => {
    if (reduced || shown) return;
    const node = ref.current;
    if (!node) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.unobserve(node);
        }
      },
      // Fire slightly before the element is fully on screen so the motion has
      // finished by the time it's centred.
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reduced, shown]);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
      className={`transition-all duration-700 ease-smooth ${
        shown ? "translate-y-0 opacity-100 blur-0" : "translate-y-6 opacity-0 blur-[2px]"
      } ${className}`}
    >
      {children}
    </div>
  );
}
