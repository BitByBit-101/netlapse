/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        // extra-small breakpoint for stat grids that are unreadable at 1 column
        xs: "440px",
      },
      colors: {
        void: "#0B0F0E",
        surface: "#12181A",
        surface2: "#1A2225",
        line: "#26302F",
        signal: "#5EEAD4",
        warn: "#F5A623",
        danger: "#F2545B",
        ink: "#E4EDEB",
        muted: "#728583",
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)",
        lift: "0 2px 4px rgba(0,0,0,0.4), 0 16px 32px -16px rgba(0,0,0,0.7)",
        glow: "0 0 0 1px rgba(94,234,212,0.25), 0 0 24px -6px rgba(94,234,212,0.35)",
      },
      transitionTimingFunction: {
        // gentle overshoot-free easing used for entrances
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        // sonar ring for the network-themed boot loader
        sonar: {
          "0%": { transform: "scale(0.35)", opacity: "0.9" },
          "70%": { opacity: "0.08" },
          "100%": { transform: "scale(1)", opacity: "0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        // indeterminate progress bar that slides across its track
        slide: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        "bar-flex": {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        // Headline characters swinging up around their own baseline in 3D, with
        // a real overshoot past the resting position before settling. The teal
        // glow fires on arrival and fades, so each letter lands with a flash.
        "char-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(0.75em) rotateX(-92deg) scale(0.82)",
            textShadow: "0 0 18px rgba(94,234,212,0.9)",
          },
          "55%": {
            opacity: "1",
            transform: "translateY(-0.11em) rotateX(14deg) scale(1.06)",
            textShadow: "0 0 14px rgba(94,234,212,0.55)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0) rotateX(0deg) scale(1)",
            textShadow: "0 0 0 rgba(94,234,212,0)",
          },
        },
        // Body copy: a rise with a slight overshoot in scale. Enough life to
        // match the headline without going per-character at paragraph length.
        "word-pop": {
          "0%": { opacity: "0", transform: "translateY(0.7em) scale(0.94)" },
          "65%": { opacity: "1", transform: "translateY(-0.06em) scale(1.015)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // Same arrival, resolving from signal-teal to body colour.
        "word-pop-tint": {
          "0%": { opacity: "0", transform: "translateY(0.7em) scale(0.94)", color: "#5EEAD4" },
          "65%": { opacity: "1", transform: "translateY(-0.06em) scale(1.015)", color: "#5EEAD4" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)", color: "#E4EDEB" },
        },
        // Underline sweeping out from the start of a line.
        "rule-in": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        // Replay steps. The card slides in from the side it travelled from, so
        // stepping backwards reads as backwards rather than as a fresh arrival.
        // Small distances only — a whole event card sweeping the width would be
        // noise on every step.
        "slide-next": {
          "0%": { opacity: "0", transform: "translateX(14px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-prev": {
          "0%": { opacity: "0", transform: "translateX(-14px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        // A packet of light running the length of the rule. Applied to a
        // full-width carrier so translateX(100%) — which resolves against the
        // element's OWN width — sweeps exactly the rule's length, keeping this
        // on the compositor instead of animating `left` and forcing layout.
        "packet-run": {
          "0%": { transform: "translateX(0%)", opacity: "0" },
          "10%": { opacity: "1" },
          "85%": { opacity: "1" },
          "100%": { transform: "translateX(100%)", opacity: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both",
        "fade-in": "fade-in 0.35s ease-out both",
        "scale-in": "scale-in 0.35s cubic-bezier(0.22,1,0.36,1) both",
        sonar: "sonar 2s cubic-bezier(0,0.2,0.8,1) infinite",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        slide: "slide 1.4s ease-in-out infinite",
        "bar-flex": "bar-flex 1.1s ease-in-out infinite",
        // `both` holds the from-state through the stagger delay, so nothing can
        // flash into view before its turn. The overshoot lives in the keyframes
        // rather than the easing curve, which keeps the landing controlled
        // instead of springy-then-abrupt.
        "char-in": "char-in 0.72s cubic-bezier(0.22,1,0.36,1) both",
        "word-pop": "word-pop 0.62s cubic-bezier(0.22,1,0.36,1) both",
        "word-pop-tint": "word-pop-tint 0.72s cubic-bezier(0.22,1,0.36,1) both",
        "rule-in": "rule-in 0.7s cubic-bezier(0.16,1,0.3,1) both",
        "slide-next": "slide-next 0.32s cubic-bezier(0.22,1,0.36,1) both",
        "slide-prev": "slide-prev 0.32s cubic-bezier(0.22,1,0.36,1) both",
        "packet-run": "packet-run 1.5s cubic-bezier(0.4,0,0.6,1) both",
      },
    },
  },
  plugins: [],
};
