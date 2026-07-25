package events

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"netlapse/internal/storage"
)

// Event is a material domain change normalized across collector signal types.
type Event struct {
	ID        string    `json:"id"`
	CapturedAt time.Time `json:"captured_at"`
	Source    string    `json:"source"`
	Severity  string    `json:"severity"`
	Title     string    `json:"title"`
	Summary   string    `json:"summary"`
}

// Build creates a reverse-chronological, time-bounded feed from existing history.
func Build(store *storage.Storage, domainID int64, since time.Time) ([]Event, error) {
	feed := make([]Event, 0)

	dns, err := store.ListDNSSnapshots(domainID)
	if err != nil {
		return nil, fmt.Errorf("load DNS history: %w", err)
	}
	for index, snapshot := range dns {
		if snapshot.CapturedAt.Before(since) {
			continue
		}
		if index == 0 {
			feed = append(feed, Event{ID: fmt.Sprintf("dns-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "dns", Severity: "info", Title: "DNS baseline recorded", Summary: "Initial DNS records were captured."})
			continue
		}
		changes := dnsChanges(dns[index-1], snapshot)
		if len(changes) > 0 {
			feed = append(feed, Event{ID: fmt.Sprintf("dns-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "dns", Severity: "warning", Title: "DNS records changed", Summary: "Changed: " + strings.Join(changes, ", ") + "."})
		}
	}

	cdns, err := store.ListCDNSnapshots(domainID)
	if err != nil {
		return nil, fmt.Errorf("load CDN history: %w", err)
	}
	for index, snapshot := range cdns {
		if snapshot.CapturedAt.Before(since) {
			continue
		}
		severity, title := "info", "CDN baseline recorded"
		summary := fmt.Sprintf("Detected provider: %s.", snapshot.Provider)
		if index > 0 {
			previous := cdns[index-1].Provider
			switch {
			case previous == snapshot.Provider:
				// Same provider, different evidence (a new edge node ID, say).
				// Not a migration, so don't raise it as a warning.
				severity, title = "info", "CDN evidence updated"
				summary = fmt.Sprintf("Still %s; detection evidence changed.", snapshot.Provider)
			case snapshot.Provider == "unknown":
				severity, title = "info", "CDN no longer identifiable"
				summary = fmt.Sprintf("Was %s; no provider fingerprint matched this pass.", previous)
			default:
				severity, title = "warning", "CDN provider changed"
				summary = fmt.Sprintf("Moved from %s to %s.", previous, snapshot.Provider)
			}
		}
		feed = append(feed, Event{ID: fmt.Sprintf("cdn-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "cdn", Severity: severity, Title: title, Summary: summary})
	}

	tls, err := store.ListTLSSnapshots(domainID)
	if err != nil {
		return nil, fmt.Errorf("load TLS history: %w", err)
	}
	for index, snapshot := range tls {
		if snapshot.CapturedAt.Before(since) {
			continue
		}
		severity, title := "info", "TLS certificate recorded"
		if index > 0 {
			severity, title = "warning", "TLS certificate or connection changed"
		}
		feed = append(feed, Event{ID: fmt.Sprintf("tls-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "tls", Severity: severity, Title: title, Summary: fmt.Sprintf("Issuer: %s; TLS: %s.", valueOrUnknown(snapshot.Issuer), valueOrUnknown(snapshot.TLSVersion))})
	}

	bgp, err := store.ListBGPEvents(domainID)
	if err != nil {
		return nil, fmt.Errorf("load BGP history: %w", err)
	}
	for _, event := range bgp {
		if event.CapturedAt.Before(since) {
			continue
		}
		severity := "info"
		if event.EventType != "origin_announced" {
			severity = "warning"
		}
		feed = append(feed, Event{ID: fmt.Sprintf("bgp-%d", event.ID), CapturedAt: event.CapturedAt, Source: "bgp", Severity: severity, Title: bgpTitle(event.EventType), Summary: fmt.Sprintf("%s: AS%s / %s to AS%s / %s.", event.IP, valueOrDash(event.PreviousASN), valueOrDash(event.PreviousPrefix), valueOrDash(event.CurrentASN), valueOrDash(event.CurrentPrefix))})
	}

	health, err := store.ListHealthSnapshots(domainID, since)
	if err != nil {
		return nil, fmt.Errorf("load health history: %w", err)
	}
	for index, snapshot := range health {
		if index == 0 || snapshot.Status == health[index-1].Status {
			continue
		}
		severity := "info"
		if snapshot.Status == "degraded" {
			severity = "warning"
		} else if snapshot.Status == "outage" {
			severity = "critical"
		}
		feed = append(feed, Event{ID: fmt.Sprintf("health-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "health", Severity: severity, Title: "Health status changed", Summary: fmt.Sprintf("Status is now %s: %.0f%% successful checks, %.0f ms average latency.", snapshot.Status, snapshot.SuccessRate*100, snapshot.AverageLatencyMs)})
	}

	routes, err := store.ListRouteSnapshots(domainID)
	if err != nil {
		return nil, fmt.Errorf("load route history: %w", err)
	}
	for index, snapshot := range routes {
		if snapshot.CapturedAt.Before(since) {
			continue
		}
		if !snapshot.Success {
			feed = append(feed, Event{ID: fmt.Sprintf("route-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "route", Severity: "warning", Title: "Route capture failed", Summary: valueOrUnknown(snapshot.Error)})
			continue
		}
		if index == 0 {
			feed = append(feed, Event{ID: fmt.Sprintf("route-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "route", Severity: "info", Title: "Route baseline recorded", Summary: fmt.Sprintf("Observed %d hops.", len(snapshot.Hops))})
		} else if routeSignature(routes[index-1]) != routeSignature(snapshot) {
			feed = append(feed, Event{ID: fmt.Sprintf("route-%d", snapshot.ID), CapturedAt: snapshot.CapturedAt, Source: "route", Severity: "warning", Title: "Route path changed", Summary: fmt.Sprintf("Hop path changed; latest capture has %d hops.", len(snapshot.Hops))})
		}
	}

	sort.Slice(feed, func(i, j int) bool { return feed[i].CapturedAt.After(feed[j].CapturedAt) })
	return feed, nil
}

func dnsChanges(previous, current storage.DNSSnapshot) []string {
	changes := make([]string, 0)
	if !sameStrings(previous.A, current.A) { changes = append(changes, "A") }
	if !sameStrings(previous.AAAA, current.AAAA) { changes = append(changes, "AAAA") }
	if previous.CNAME != current.CNAME { changes = append(changes, "CNAME") }
	if !sameStrings(previous.NS, current.NS) { changes = append(changes, "NS") }
	if !sameStrings(previous.MX, current.MX) { changes = append(changes, "MX") }
	if !sameStrings(previous.TXT, current.TXT) { changes = append(changes, "TXT") }
	return changes
}

func sameStrings(left, right []string) bool { return strings.Join(left, "\x00") == strings.Join(right, "\x00") }
func valueOrUnknown(value string) string { if value == "" { return "unknown" }; return value }
func valueOrDash(value string) string { if value == "" { return "-" }; return value }

func routeSignature(snapshot storage.RouteSnapshot) string {
	parts := make([]string, 0, len(snapshot.Hops))
	for _, hop := range snapshot.Hops { parts = append(parts, hop.Address) }
	return strings.Join(parts, ",")
}

func bgpTitle(eventType string) string {
	switch eventType {
	case "origin_changed": return "BGP origin ASN changed"
	case "prefix_changed": return "BGP prefix changed"
	case "origin_withdrawn": return "BGP origin withdrawn"
	default: return "BGP origin announced"
	}
}