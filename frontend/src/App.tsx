import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import {
  api,
  Domain,
  DnsSnapshot,
  LatencySample,
  CdnSnapshot,
  AsnSnapshot,
  TlsSnapshot,
  RouteSnapshot,
  HealthSnapshot,
  BgpEvent,
  InvestigationReport,
  InternetEvent,
  PredictionForecast,
  SimilarDomain,
} from "./api";
import DomainList from "./components/DomainList";
import ConfirmDialog from "./components/ConfirmDialog";
import DnsTimeline from "./components/DnsTimeline";
import CdnTimeline from "./components/CdnTimeline";
import AsnTimeline from "./components/AsnTimeline";
import TlsTimeline from "./components/TlsTimeline";
import RouteTimeline from "./components/RouteTimeline";
import WeatherHeatmap from "./components/WeatherHeatmap";
import BgpTimeline from "./components/BgpTimeline";
import InvestigatorReportView from "./components/InvestigatorReport";
import InternetEvents from "./components/InternetEvents";
import ReplayMode from "./components/ReplayMode";
import PredictionPanel from "./components/PredictionPanel";
import SimilaritySearch from "./components/SimilaritySearch";
import InternetTimeline from "./components/InternetTimeline";
import NetworkDiff from "./components/NetworkDiff";
import {
  ChartSkeleton,
  TimelineSkeleton,
  CardListSkeleton,
  SonarLoader,
  ProgressBar,
  Spinner,
} from "./components/Loaders";

/**
 * Code-split views.
 *
 * recharts and three are the two heaviest dependencies in the app, and each is
 * used by exactly one tab. Loading them on demand cut the initial bundle from
 * 1,201 kB to 248 kB — worth most on the landing page, which renders neither but
 * previously downloaded both.
 */
const LatencyChart = lazy(() => import("./components/LatencyChart"));
const DigitalTwin = lazy(() => import("./components/DigitalTwin"));

const RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

const TABS = [
  { key: "latency", label: "Latency" },
  { key: "dns", label: "DNS" },
  { key: "cdn", label: "CDN" },
  { key: "asn", label: "ASN" },
  { key: "tls", label: "TLS" },
  { key: "route", label: "Route" },
  { key: "weather", label: "Weather" },
  { key: "bgp", label: "BGP" },
  { key: "investigate", label: "Investigate" },
  { key: "events", label: "Events" },
  { key: "replay", label: "Replay" },
  { key: "predict", label: "Predict" },
  { key: "similar", label: "Similar" },
  { key: "timeline", label: "Timeline" },
  { key: "diff", label: "Diff" },
  { key: "twin", label: "Twin" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function App() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("latency");

  const [dnsSnapshots, setDnsSnapshots] = useState<DnsSnapshot[]>([]);
  const [latencySamples, setLatencySamples] = useState<LatencySample[]>([]);
  const [cdnSnapshots, setCdnSnapshots] = useState<CdnSnapshot[]>([]);
  const [asnSnapshots, setAsnSnapshots] = useState<AsnSnapshot[]>([]);
  const [tlsSnapshots, setTlsSnapshots] = useState<TlsSnapshot[]>([]);
  const [routeSnapshots, setRouteSnapshots] = useState<RouteSnapshot[]>([]);
  const [healthSnapshots, setHealthSnapshots] = useState<HealthSnapshot[]>([]);
  const [bgpEvents, setBgpEvents] = useState<BgpEvent[]>([]);
  const [investigation, setInvestigation] = useState<InvestigationReport | null>(null);
  const [internetEvents, setInternetEvents] = useState<InternetEvent[]>([]);
  const [forecast, setForecast] = useState<PredictionForecast | null>(null);
  const [similarDomains, setSimilarDomains] = useState<SimilarDomain[]>([]);

  const [rangeHours, setRangeHours] = useState(24);
  const [error, setError] = useState<string | null>(null);

  // Distinguish the three states the old UI conflated into one:
  //   domainsLoading — first domain list request still in flight
  //   loadingHistory — no data for this domain yet, show skeletons
  //   refreshing     — data on screen, background poll running, show hairline
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Which domain the delete confirmation is open for, if any.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Which domain the currently-rendered history belongs to. Lets us show
  // skeletons when switching domains instead of the previous domain's data.
  const loadedFor = useRef<string | null>(null);

  const refreshDomains = useCallback(async () => {
    try {
      const list = await api.listDomains();
      const domainList = Array.isArray(list) ? list : [];
      setDomains(domainList);
      if (!selected && domainList.length > 0) setSelected(domainList[0].name);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDomainsLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    refreshDomains();
  }, [refreshDomains]);

  const refreshHistory = useCallback(async () => {
    if (!selected) return;

    const isFirstLoadForDomain = loadedFor.current !== selected;
    if (isFirstLoadForDomain) setLoadingHistory(true);
    else setRefreshing(true);

    try {
      const [dns, latency, cdn, asn, tlsHist, routes, health, bgp, report, events, prediction, similar] = await Promise.all([
        api.dnsHistory(selected),
        api.latencyHistory(selected, rangeHours),
        api.cdnHistory(selected),
        api.asnHistory(selected),
        api.tlsHistory(selected),
        api.routeHistory(selected),
        api.healthHistory(selected),
        api.bgpHistory(selected),
        api.investigate(selected),
        api.events(selected),
        api.predict(selected),
        api.similar(selected),
      ]);
      setDnsSnapshots(dns);
      setLatencySamples(latency);
      setCdnSnapshots(cdn);
      setAsnSnapshots(asn);
      setTlsSnapshots(tlsHist);
      setRouteSnapshots(routes);
      setHealthSnapshots(health);
      setBgpEvents(bgp);
      setInvestigation(report);
      setInternetEvents(events);
      setForecast(prediction);
      setSimilarDomains(similar);
      setError(null);
      loadedFor.current = selected;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingHistory(false);
      setRefreshing(false);
    }
  }, [selected, rangeHours]);

  useEffect(() => {
    refreshHistory();
    const id = setInterval(refreshHistory, 15_000);
    return () => clearInterval(id);
  }, [refreshHistory]);

  const handleAdd = async (name: string) => {
    await api.addDomain(name);
    await refreshDomains();
    setSelected(name);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteDomain(pendingDelete);

      const remaining = domains.filter((d) => d.name !== pendingDelete);
      setDomains(remaining);

      // Deleting the domain on screen would otherwise leave the dashboard
      // showing history for something no longer tracked, and the 15s poll would
      // then fail against a 404. Move to a neighbour, or to the empty state.
      if (selected === pendingDelete) {
        const next = remaining[0]?.name ?? null;
        setSelected(next);
        // Force a fresh load rather than reusing the deleted domain's data.
        loadedFor.current = null;
        if (!next) {
          setDnsSnapshots([]);
          setLatencySamples([]);
          setCdnSnapshots([]);
          setAsnSnapshots([]);
          setTlsSnapshots([]);
          setRouteSnapshots([]);
          setHealthSnapshots([]);
          setBgpEvents([]);
          setInvestigation(null);
          setInternetEvents([]);
          setForecast(null);
          setSimilarDomains([]);
        }
      }

      setPendingDelete(null);
      setError(null);
    } catch (e) {
      // Keep the dialog open showing why, rather than closing as if it worked.
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const handleSelect = (name: string) => {
    setSelected(name);
    setNavOpen(false); // close the mobile drawer after picking a domain
  };

  // Close the drawer on Escape — expected behaviour for any overlay.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // `loading` is what the tab bodies below branch on: true only when we have
  // nothing real to show for the selected domain yet.
  const loading = loadingHistory && loadedFor.current !== selected;

  return (
    <div className="flex h-full overflow-hidden">
      <ProgressBar active={refreshing || domainsLoading} />

      {/* Scrim behind the mobile drawer. Hidden from AT; the drawer has its own controls. */}
      <div
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-30 bg-void/70 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          navOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Sidebar: off-canvas drawer under lg, static column at lg and up. */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-[min(84vw,17rem)] transform transition-transform duration-300 ease-smooth lg:static lg:z-auto lg:w-64 lg:translate-x-0 ${
          navOpen ? "translate-x-0 shadow-lift" : "-translate-x-full"
        }`}
      >
        <DomainList
          domains={domains}
          selected={selected}
          onSelect={handleSelect}
          onAdd={handleAdd}
          onRequestDelete={(name) => {
            setPendingDelete(name);
            setDeleteError(null);
          }}
          loading={domainsLoading}
          onClose={() => setNavOpen(false)}
        />
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Stop tracking ${pendingDelete}?`}
          body={
            <>
              This permanently deletes every record collected for{" "}
              <span className="font-mono text-ink">{pendingDelete}</span> — DNS, latency, routes, TLS,
              CDN, ASN, health and BGP history. This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          destructive
          busy={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setPendingDelete(null);
            setDeleteError(null);
          }}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Mobile top bar — the only way to reach the domain list under lg. */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-void/85 px-4 py-3 backdrop-blur-md lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open domain list"
            aria-expanded={navOpen}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-muted transition-colors hover:border-signal/50 hover:text-signal active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm text-ink">{selected ?? "netlapse"}</p>
          </div>
          {refreshing && <Spinner className="h-3.5 w-3.5 text-signal" />}
        </div>

        {error && (
          <div className="animate-fade-up mx-4 mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 font-mono text-xs text-danger sm:text-sm">
            {error} — is the backend running on http://localhost:8080?
          </div>
        )}

        {domainsLoading && !selected ? (
          <div className="grid flex-1 place-items-center">
            <SonarLoader label="Connecting" />
          </div>
        ) : !selected ? (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div className="animate-fade-up">
              <p className="text-sm text-ink/80">No domain selected.</p>
              <p className="mt-1.5 text-xs text-muted">
                Add a domain <span className="lg:hidden">from the menu</span>
                <span className="hidden lg:inline">on the left</span> to start recording its history.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            <header className="animate-fade-up mb-5 sm:mb-6">
              <div className="flex items-center gap-2.5">
                <h1 className="font-mono text-xl text-ink sm:text-2xl">{selected}</h1>
                {refreshing && <Spinner className="hidden h-3.5 w-3.5 text-signal lg:inline-block" />}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted sm:text-sm">
                Recording DNS, CDN, ASN ownership, TLS certificates, and latency over time.
              </p>
            </header>

            {/* Tab strip: horizontally scrollable on narrow screens instead of
                wrapping 16 items into a tall block. */}
            <nav className="relative -mx-4 mb-5 border-b border-line px-4 sm:mx-0 sm:mb-6 sm:px-0">
              <div className="no-scrollbar mask-fade-r flex gap-1 overflow-x-auto sm:flex-wrap">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    aria-current={tab === t.key ? "page" : undefined}
                    className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-wide transition-all duration-200 sm:text-xs ${
                      tab === t.key
                        ? "border-signal text-signal"
                        : "border-transparent text-muted hover:border-line hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </nav>

            {/* key={tab} restarts the entrance animation on every tab change,
                which reads as a deliberate transition rather than a swap. */}
            <div key={tab} className="animate-fade-up">
              {tab === "latency" && (
                <section>
                  <div className="mb-3 flex items-center justify-end">
                    <div className="flex gap-1" role="group" aria-label="Latency time range">
                      {RANGES.map((r) => (
                        <button
                          key={r.label}
                          onClick={() => setRangeHours(r.hours)}
                          aria-pressed={rangeHours === r.hours}
                          className={`rounded border px-2.5 py-1 font-mono text-xs transition-all duration-200 active:scale-95 ${
                            rangeHours === r.hours
                              ? "border-signal text-signal bg-signal/10 shadow-glow"
                              : "border-line text-muted hover:border-line/80 hover:text-ink"
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="card card-hover p-3 sm:p-4">
                    {loading ? (
                      <ChartSkeleton />
                    ) : (
                      // Same skeleton for the chunk fetch as for the data load, so
                      // a cold cache looks like loading rather than a layout jump.
                      <Suspense fallback={<ChartSkeleton />}>
                        <LatencyChart samples={latencySamples} />
                      </Suspense>
                    )}
                  </div>
                </section>
              )}

              {tab === "dns" && (loading ? <TimelineSkeleton rows={3} lines={4} /> : <DnsTimeline snapshots={dnsSnapshots} />)}
              {tab === "cdn" && (loading ? <TimelineSkeleton rows={3} lines={1} /> : <CdnTimeline snapshots={cdnSnapshots} />)}
              {tab === "asn" && (loading ? <TimelineSkeleton rows={2} lines={4} /> : <AsnTimeline snapshots={asnSnapshots} />)}
              {tab === "tls" && (loading ? <TimelineSkeleton rows={2} lines={5} /> : <TlsTimeline snapshots={tlsSnapshots} />)}
              {tab === "route" && (loading ? <TimelineSkeleton rows={4} lines={1} /> : <RouteTimeline snapshots={routeSnapshots} />)}
              {tab === "weather" && (loading ? <SonarLoader label="Reading weather" /> : <WeatherHeatmap snapshots={healthSnapshots} />)}
              {tab === "bgp" && (loading ? <TimelineSkeleton rows={2} lines={2} /> : <BgpTimeline events={bgpEvents} />)}
              {tab === "investigate" && (loading ? <CardListSkeleton rows={3} /> : <InvestigatorReportView report={investigation} />)}
              {tab === "events" && (loading ? <CardListSkeleton rows={5} /> : <InternetEvents events={internetEvents} />)}
              {tab === "replay" && (loading ? <SonarLoader label="Loading replay" /> : <ReplayMode events={internetEvents} />)}
              {tab === "predict" && (loading ? <CardListSkeleton rows={2} /> : <PredictionPanel forecast={forecast} />)}
              {tab === "similar" && (loading ? <CardListSkeleton rows={3} /> : <SimilaritySearch matches={similarDomains} />)}
              {tab === "timeline" && (loading ? <TimelineSkeleton rows={4} lines={2} /> : <InternetTimeline events={internetEvents} />)}
              {tab === "diff" && (loading ? <CardListSkeleton rows={2} /> : <NetworkDiff dnsSnapshots={dnsSnapshots} cdnSnapshots={cdnSnapshots} tlsSnapshots={tlsSnapshots} />)}
              {tab === "twin" &&
                (loading ? (
                  <SonarLoader label="Building twin" />
                ) : (
                  <Suspense fallback={<SonarLoader label="Building twin" />}>
                    <DigitalTwin domain={selected} routes={routeSnapshots} latencySamples={latencySamples} />
                  </Suspense>
                ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
