package investigator

import (
	"fmt"
	"time"

	"netlapse/internal/storage"
)

// Finding is an evidence-backed observation about a tracked domain.
type Finding struct {
	Severity string `json:"severity"`
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Evidence string `json:"evidence"`
	Action   string `json:"action"`
}

// Report is the current investigation summary for a domain.
type Report struct {
	Domain      string    `json:"domain"`
	GeneratedAt time.Time `json:"generated_at"`
	Findings    []Finding `json:"findings"`
	Narrative   string    `json:"narrative,omitempty"`
	LLMModel    string    `json:"llm_model,omitempty"`
	LLMStatus   string    `json:"llm_status"`
	LLMError    string    `json:"llm_error,omitempty"`
}

// Analyze converts recent observations into a small, transparent investigation report.
func Analyze(store *storage.Storage, domain string, domainID int64) (Report, error) {
	now := time.Now().UTC()
	report := Report{Domain: domain, GeneratedAt: now, Findings: make([]Finding, 0), LLMStatus: "disabled"}

	health, err := store.ListHealthSnapshots(domainID, now.Add(-24*time.Hour))
	if err != nil {
		return report, fmt.Errorf("load health history: %w", err)
	}
	if len(health) > 0 {
		latest := health[len(health)-1]
		switch latest.Status {
		case "outage":
			report.Findings = append(report.Findings, Finding{
				Severity: "critical", Title: "Recent availability outage",
				Summary: "The latest health window is classified as an outage.",
				Evidence: fmt.Sprintf("%.0f%% of recent TCP checks succeeded.", latest.SuccessRate*100),
				Action: "Check the latency timeline and route capture, then verify the service from another network.",
			})
		case "degraded":
			report.Findings = append(report.Findings, Finding{
				Severity: "warning", Title: "Recent service degradation",
				Summary: "Recent reachability or latency is outside the healthy threshold.",
				Evidence: fmt.Sprintf("%.0f%% successful checks; average successful connection %.0f ms.", latest.SuccessRate*100, latest.AverageLatencyMs),
				Action: "Compare latency samples and route hops with a later capture before escalating.",
			})
		}
	}

	latency, err := store.ListLatencySamples(domainID, now.Add(-24*time.Hour))
	if err != nil {
		return report, fmt.Errorf("load latency history: %w", err)
	}
	failures := 0
	for _, sample := range latency {
		if !sample.Success {
			failures++
		}
	}
	if failures > 0 {
		report.Findings = append(report.Findings, Finding{
			Severity: "warning", Title: "Connection failures observed",
			Summary: "At least one TCP connection to HTTPS failed in the last 24 hours.",
			Evidence: fmt.Sprintf("%d failed connection attempt(s) across %d samples.", failures, len(latency)),
			Action: "Inspect the latency error text and confirm whether the issue reproduces outside this collector.",
		})
	}

	routes, err := store.ListRouteSnapshots(domainID)
	if err != nil {
		return report, fmt.Errorf("load route history: %w", err)
	}
	if len(routes) > 0 {
		latest := routes[len(routes)-1]
		if !latest.Success {
			report.Findings = append(report.Findings, Finding{
				Severity: "warning", Title: "Route capture failed",
				Summary: "The most recent traceroute did not complete.", Evidence: latest.Error,
				Action: "Run another capture later; routers commonly rate-limit or block traceroute responses.",
			})
		}
	}

	bgpEvents, err := store.ListBGPEvents(domainID)
	if err != nil {
		return report, fmt.Errorf("load BGP history: %w", err)
	}
	routingChanges := 0
	for _, event := range bgpEvents {
		if event.CapturedAt.After(now.Add(-24*time.Hour)) && event.EventType != "origin_announced" {
			routingChanges++
		}
	}
	if routingChanges > 0 {
		report.Findings = append(report.Findings, Finding{
			Severity: "info", Title: "Recent routing change",
			Summary: "The BGP detector observed a change in the origin ASN or announced prefix.",
			Evidence: fmt.Sprintf("%d routing change event(s) in the last 24 hours.", routingChanges),
			Action: "Compare the BGP feed with DNS and CDN changes to determine whether traffic may have moved networks.",
		})
	}

	tls, err := store.LatestTLSSnapshot(domainID)
	if err != nil {
		return report, fmt.Errorf("load TLS history: %w", err)
	}
	if tls != nil {
		daysRemaining := int(time.Until(tls.NotAfter).Hours() / 24)
		if daysRemaining < 30 {
			severity := "warning"
			if daysRemaining < 14 {
				severity = "critical"
			}
			report.Findings = append(report.Findings, Finding{
				Severity: severity, Title: "TLS certificate nearing expiry",
				Summary: "The observed HTTPS certificate expires soon.",
				Evidence: fmt.Sprintf("Certificate expires in %d day(s).", daysRemaining),
				Action: "Confirm certificate renewal is scheduled and validate the renewed certificate after deployment.",
			})
		}
	}

	if len(report.Findings) == 0 {
		report.Findings = append(report.Findings, Finding{
			Severity: "healthy", Title: "No active concerns detected",
			Summary: "Recent collected signals do not show an availability, routing, or certificate issue.",
			Evidence: fmt.Sprintf("Reviewed %d latency sample(s), %d health window(s), and %d BGP event(s).", len(latency), len(health), len(bgpEvents)),
			Action: "Continue collecting history; investigations become more precise as the timeline grows.",
		})
	}

	return report, nil
}