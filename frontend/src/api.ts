/**
 * Where the API lives.
 *
 * `??` rather than `||` on purpose: behind a reverse proxy the frontend and API
 * share an origin, which is expressed by building with `VITE_API_URL=""` so
 * every request goes to a relative `/api/...` path. An empty string is falsy,
 * so `||` would have thrown that away and silently hard-coded localhost:8080
 * into the production bundle. Unset (undefined) still means local dev.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export interface Domain {
  id: number;
  name: string;
}

export interface DnsSnapshot {
  id: number;
  captured_at: string;
  a_records: string[] | null;
  aaaa_records: string[] | null;
  cname: string;
  ns_records: string[] | null;
  mx_records: string[] | null;
  txt_records: string[] | null;
}

export interface LatencySample {
  id: number;
  captured_at: string;
  latency_ms: number;
  success: boolean;
  error?: string;
}

export interface CdnSnapshot {
  id: number;
  captured_at: string;
  provider: string;
  detected_via: string;
  evidence: string;
}

export interface AsnEntry {
  ip: string;
  asn: string;
  as_name: string;
  country: string;
  registry: string;
  allocated: string;
  prefix: string;
}

export interface AsnSnapshot {
  captured_at: string;
  entries: AsnEntry[];
}

export interface TlsSnapshot {
  id: number;
  captured_at: string;
  issuer: string;
  subject: string;
  serial_number: string;
  not_before: string;
  not_after: string;
  tls_version: string;
  cipher_suite: string;
  san_records: string[] | null;
}

export interface RouteHop {
  hop: number;
  address: string;
  latency_ms: number;
  /** True only when every probe to this hop was lost. */
  timed_out: boolean;
  probes_sent: number;
  probes_lost: number;
  min_latency_ms: number;
  max_latency_ms: number;
  /** Owning network, from Team Cymru. Absent for private or unregistered hops. */
  asn?: string;
  as_name?: string;
  country?: string;
  /** RFC1918 / link-local address with no public owner. */
  private?: boolean;
}

export interface RouteSnapshot {
  id: number;
  captured_at: string;
  hops: RouteHop[];
  success: boolean;
  error?: string;
}

export interface HealthSnapshot {
  id: number;
  captured_at: string;
  success_rate: number;
  average_latency_ms: number;
  status: "healthy" | "degraded" | "outage";
}

export interface BgpEvent {
  id: number;
  captured_at: string;
  event_type: "origin_announced" | "origin_changed" | "origin_withdrawn" | "prefix_changed";
  ip: string;
  previous_asn: string;
  current_asn: string;
  previous_prefix: string;
  current_prefix: string;
}

export interface InvestigationFinding {
  severity: "critical" | "warning" | "info" | "healthy";
  title: string;
  summary: string;
  evidence: string;
  action: string;
}

export interface InvestigationReport {
  domain: string;
  generated_at: string;
  findings: InvestigationFinding[];
  narrative?: string;
  llm_model?: string;
  llm_status: "disabled" | "ready" | "unavailable" | "rejected";
}

export interface InternetEvent {
  id: string;
  captured_at: string;
  source: "dns" | "cdn" | "tls" | "bgp" | "health" | "route";
  severity: "critical" | "warning" | "info";
  title: string;
  summary: string;
}

export interface PredictionPoint {
  hours_ahead: number;
  predicted_latency_ms: number;
  /** ± half-width of a rough 95% prediction interval, widening with horizon. */
  interval_ms: number;
}

export interface PredictionForecast {
  domain: string;
  generated_at: string;
  sample_count: number;
  recent_success_rate: number;
  baseline_latency_ms: number;
  trend_ms_per_hour: number;
  confidence: "high" | "medium" | "low" | "insufficient";
  confidence_reason: string;
  points: PredictionPoint[];
  /** Bounds of what was actually observed, for comparison against projections. */
  observed_min_ms: number;
  observed_max_ms: number;
  /** Outlier-resistant expectation, used in place of the trend when it's weak. */
  median_latency_ms: number;
  /** Share of variance the trend explains, 0..1. */
  r_squared: number;
  /** False when the data can't support projecting the trend forward. */
  trend_meaningful: boolean;
}

export interface SimilarDomain {
  domain: string;
  score: number;
  reasons: string[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  listDomains: () => request<Domain[]>("/api/domains"),
  addDomain: (domain: string) =>
    request<{ id: number; name: string }>("/api/domains", {
      method: "POST",
      body: JSON.stringify({ domain }),
    }),
  /** Removes the domain and every record collected for it. Not reversible. */
  deleteDomain: (domain: string) =>
    request<{ deleted: string }>(`/api/domains/${encodeURIComponent(domain)}`, {
      method: "DELETE",
    }),
  dnsHistory: (domain: string) =>
    request<DnsSnapshot[]>(`/api/history/dns/${encodeURIComponent(domain)}`),
  latencyHistory: (domain: string, sinceHours = 24) =>
    request<LatencySample[]>(
      `/api/history/latency/${encodeURIComponent(domain)}?since_hours=${sinceHours}`
    ),
  cdnHistory: (domain: string) =>
    request<CdnSnapshot[]>(`/api/history/cdn/${encodeURIComponent(domain)}`),
  asnHistory: (domain: string) =>
    request<AsnSnapshot[]>(`/api/history/asn/${encodeURIComponent(domain)}`),
  tlsHistory: (domain: string) =>
    request<TlsSnapshot[]>(`/api/history/tls/${encodeURIComponent(domain)}`),
  routeHistory: (domain: string) =>
    request<RouteSnapshot[]>(`/api/history/route/${encodeURIComponent(domain)}`),
  healthHistory: (domain: string, sinceHours = 24 * 7) =>
    request<HealthSnapshot[]>(
      `/api/history/health/${encodeURIComponent(domain)}?since_hours=${sinceHours}`
    ),
  bgpHistory: (domain: string) =>
    request<BgpEvent[]>(`/api/history/bgp/${encodeURIComponent(domain)}`),
  investigate: (domain: string) =>
    request<InvestigationReport>(`/api/investigate/${encodeURIComponent(domain)}`),
  events: (domain: string, sinceHours = 24 * 7) =>
    request<InternetEvent[]>(
      `/api/events/${encodeURIComponent(domain)}?since_hours=${sinceHours}`
    ),
  predict: (domain: string) =>
    request<PredictionForecast>(`/api/predict/${encodeURIComponent(domain)}`),
  similar: (domain: string) =>
    request<SimilarDomain[]>(`/api/similar/${encodeURIComponent(domain)}`),
};
