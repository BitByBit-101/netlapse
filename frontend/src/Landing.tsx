import { useEffect, useState } from "react";
import SnakeGame from "./components/SnakeGame";
import Reveal from "./components/Reveal";
import { CharReveal, PacketUnderline, WordReveal } from "./components/AnimatedText";

/**
 * Marketing landing page. Deliberately dependency-free: navigation to the
 * dashboard is a hash change (#/app) that main.tsx listens for, so this works
 * on any static host without a router or server rewrites.
 */

const FEATURES = [
  {
    tag: "DNS",
    title: "Git-style DNS history",
    body: "A/AAAA/CNAME/NS/MX/TXT are resolved on an interval, but a snapshot is only written when something actually changed. You get a commit log of a domain's DNS, not a row every minute.",
  },
  {
    tag: "Latency",
    title: "Latency you can trust",
    body: "Times a real TCP handshake to port 443 instead of ICMP ping, so it needs no root privileges and measures what your users actually wait for.",
  },
  {
    tag: "CDN",
    title: "Edge provider detection",
    body: "Escalates through three signals — CNAME target, edge headers across every redirect hop, then the owning ASN — and labels how confident each answer is. A domain with no CDN gets named as self-hosted rather than dismissed as unknown.",
  },
  {
    tag: "ASN",
    title: "Who owns the IP",
    body: "Resolves each address to its owning network and organisation through Team Cymru's free DNS whois service. No API key, no rate-limit tier.",
  },
  {
    tag: "TLS",
    title: "Certificate lifecycle",
    body: "Inspects the live certificate and records a new entry whenever the serial number, negotiated TLS version, or cipher changes. Expiry warnings come free.",
  },
  {
    tag: "Route",
    title: "Path and topology",
    body: "Captures traceroute hops over time and renders them as an explorable 3D topology, so a routing change is something you can see rather than diff by hand.",
  },
];

const STATS = [
  { value: "5", label: "collectors" },
  { value: "1", label: "SQLite file" },
  { value: "0", label: "API keys" },
  { value: "16", label: "dashboard views" },
];

const STEPS = [
  { n: "01", t: "Add a domain", d: "Type a hostname. The first DNS snapshot and latency sample fire immediately — no empty charts." },
  { n: "02", t: "Collectors tick", d: "Independent goroutines poll DNS, latency, CDN, ASN, TLS, routes, and health on their own schedules." },
  { n: "03", t: "Only changes persist", d: "Each collector diffs against the last snapshot and writes only when the signal genuinely moved." },
  { n: "04", t: "Read the history", d: "Timelines, a unified event feed, chronological replay, forecasts, and similarity search across everything recorded." },
];

function goToApp() {
  window.location.hash = "#/app";
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-full overflow-x-hidden bg-void">
      {/* Header */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          scrolled ? "border-b border-line bg-void/85 backdrop-blur-md" : "border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="relative grid h-2.5 w-2.5 place-items-center">
              <span className="absolute inset-0 animate-sonar rounded-full border border-signal" />
              <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            </span>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal sm:text-xs">netlapse</p>
          </div>
          <nav className="flex items-center gap-1 sm:gap-4">
            <a
              href="#features"
              className="hidden rounded px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:text-ink sm:block"
            >
              Features
            </a>
            <a
              href="#how"
              className="hidden rounded px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:text-ink sm:block"
            >
              How
            </a>
            <button
              onClick={goToApp}
              className="rounded border border-signal/40 bg-signal/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-signal transition-all hover:bg-signal/20 hover:shadow-glow active:scale-95"
            >
              Open app
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative px-4 pb-16 pt-24 sm:px-6 sm:pb-24 sm:pt-32">
        {/* Ambient glow. Pointer-events-none so it never eats a click. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[min(90vw,780px)] -translate-x-1/2 rounded-full bg-signal/10 blur-[110px]"
        />

        <div className="relative mx-auto max-w-6xl">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
            {/* Copy — short by design; the depth lives further down the page.
                No fade-up on this wrapper: it would translate the whole block
                while the words are rising inside it, and two nested transforms
                make the motion look like it's fighting itself. Each child owns
                its own entrance instead. */}
            <div>
              <p className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-signal" />
                the internet time machine
              </p>

              {/* The real sentences live on aria-label; the per-word markup is
                  hidden from assistive tech because split words read poorly. */}
              <h1
                className="mt-5 text-3xl font-medium leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-6xl"
                aria-label="The internet forgets. This doesn't."
              >
                <span aria-hidden="true">
                  <CharReveal text="The internet forgets." delay={120} stagger={30} />
                  <br />
                  {/* The payoff line lands harder: a wider stagger so each
                      character is individually legible as it flips in. */}
                  <span className="relative inline-block text-signal">
                    <CharReveal text="This doesn't." delay={820} stagger={46} />
                    <PacketUnderline delay={1420} />
                  </span>
                </span>
              </h1>

              <p
                className="mt-5 max-w-xl text-sm leading-relaxed text-ink/70 sm:text-base"
                aria-label="netlapse quietly records what a domain looked like — DNS, latency, CDN, IP ownership, and TLS certificates — and keeps every change as history you can scroll back through. All of it in a single SQLite file on your own machine."
              >
                <span aria-hidden="true">
                  <WordReveal
                    delay={1500}
                    stagger={24}
                    segments={[
                      "netlapse quietly records what a domain looked like — ",
                      { text: "DNS, latency, CDN, IP ownership, and TLS certificates", highlight: true },
                      " — and keeps every change as history you can scroll back through. All of it in a single ",
                      { text: "SQLite file", highlight: true },
                      " on your own machine.",
                    ]}
                  />
                </span>
              </p>

              <div className="animate-fade-up mt-7 flex flex-wrap items-center gap-3" style={{ animationDelay: "2500ms" }}>
                <button
                  onClick={goToApp}
                  className="group rounded-lg border border-signal/50 bg-signal/15 px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-signal transition-all hover:bg-signal/25 hover:shadow-glow active:scale-95"
                >
                  Open the dashboard
                  <span aria-hidden="true" className="ml-2 inline-block transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </button>
                <a
                  href="#features"
                  className="rounded-lg border border-line px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-muted transition-all hover:border-line/80 hover:text-ink active:scale-95"
                >
                  What it records
                </a>
              </div>
            </div>

            {/* Game */}
            <div className="animate-fade-up lg:mt-0" style={{ animationDelay: "140ms" }}>
              <div className="rounded-xl border border-line bg-surface/40 p-3 shadow-lift backdrop-blur-sm sm:p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                    packet<span className="text-signal">.</span>snake
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted/60">endless</p>
                </div>
                <SnakeGame />
              </div>
            </div>
          </div>

          {/* Stats */}
          <Reveal delay={80}>
            <dl className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:mt-20 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="bg-void px-4 py-5 text-center transition-colors hover:bg-surface/60">
                  <dd className="font-mono text-2xl text-signal sm:text-3xl">{stat.value}</dd>
                  <dt className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 border-t border-line px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">what it records</p>
            <h2 className="mt-3 max-w-2xl text-2xl leading-tight tracking-tight text-ink sm:text-4xl">
              Five collectors, each writing only when something changes.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink/60 sm:text-base">
              Every module diffs against the previous snapshot before it writes. The result is a readable history
              instead of a firehose of duplicate rows.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.tag} delay={(i % 3) * 90}>
                <article className="group h-full rounded-lg border border-line bg-surface/40 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-signal/30 hover:bg-surface/70 hover:shadow-lift">
                  <span className="inline-block rounded border border-signal/30 bg-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-signal">
                    {feature.tag}
                  </span>
                  <h3 className="mt-4 font-mono text-sm text-ink">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink/65">{feature.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 border-t border-line px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <Reveal>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">how it works</p>
            <h2 className="mt-3 text-2xl leading-tight tracking-tight text-ink sm:text-4xl">
              Add a domain. Walk away. Come back to history.
            </h2>
          </Reveal>

          <div className="mt-10 space-y-px overflow-hidden rounded-lg border border-line bg-line sm:mt-14">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} delay={i * 70}>
                <div className="group flex gap-4 bg-void px-4 py-5 transition-colors hover:bg-surface/60 sm:gap-6 sm:px-6">
                  <span className="font-mono text-xs text-signal/50 transition-colors group-hover:text-signal">
                    {step.n}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-mono text-sm text-ink">{step.t}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink/60">{step.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="relative border-t border-line px-4 py-20 sm:px-6 sm:py-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-1/2 h-[300px] w-[min(90vw,640px)] -translate-x-1/2 rounded-full bg-signal/10 blur-[100px]"
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <Reveal>
            <h2 className="text-2xl leading-tight tracking-tight text-ink sm:text-4xl">
              A week of uptime is where it gets interesting.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink/65 sm:text-base">
              Leave the collectors running and real-world DNS drift, certificate renewals, and CDN migrations start
              showing up on their own.
            </p>
            <button
              onClick={goToApp}
              className="group mt-8 rounded-lg border border-signal/50 bg-signal/15 px-6 py-3 font-mono text-xs uppercase tracking-wider text-signal transition-all hover:bg-signal/25 hover:shadow-glow active:scale-95"
            >
              Start recording
              <span aria-hidden="true" className="ml-2 inline-block transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </button>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-line px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">netlapse v0</p>
        </div>
      </footer>
    </div>
  );
}
