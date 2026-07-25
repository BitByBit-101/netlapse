package similarity

import (
	"fmt"
	"sort"
	"time"

	"netlapse/internal/storage"
)

// Match is a ranked domain with the signals contributing to its similarity score.
type Match struct {
	Domain string   `json:"domain"`
	Score  float64  `json:"score"`
	Reasons []string `json:"reasons"`
}

type profile struct {
	cdn    string
	asns   map[string]bool
	ips    map[string]bool
	status string
	latency float64
}

// Find ranks every other tracked domain by current network-profile similarity.
func Find(store *storage.Storage, domainID int64) ([]Match, error) {
	domains, err := store.ListDomains()
	if err != nil { return nil, fmt.Errorf("list domains: %w", err) }
	profiles := make(map[int64]profile, len(domains))
	for _, domain := range domains {
		current, err := loadProfile(store, domain.ID)
		if err != nil { return nil, err }
		profiles[domain.ID] = current
	}
	target := profiles[domainID]
	matches := make([]Match, 0, len(domains)-1)
	for _, domain := range domains {
		if domain.ID == domainID { continue }
		score, reasons := compare(target, profiles[domain.ID])
		matches = append(matches, Match{Domain: domain.Name, Score: score, Reasons: reasons})
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Score > matches[j].Score })
	return matches, nil
}

func loadProfile(store *storage.Storage, domainID int64) (profile, error) {
	result := profile{asns: map[string]bool{}, ips: map[string]bool{}}
	cdn, err := store.LatestCDNSnapshot(domainID)
	if err != nil { return result, fmt.Errorf("load CDN profile: %w", err) }
	// "unknown" is the absence of a detection, not a provider. Treating it as
	// one made every undetected pair score +0.30 for "same CDN provider".
	if cdn != nil && cdn.Provider != "unknown" { result.cdn = cdn.Provider }
	asn, err := store.LatestASNSnapshot(domainID)
	if err != nil { return result, fmt.Errorf("load ASN profile: %w", err) }
	if asn != nil { for _, entry := range asn.Entries { if entry.ASN != "" { result.asns[entry.ASN] = true } } }
	dns, err := store.LatestDNSSnapshot(domainID)
	if err != nil { return result, fmt.Errorf("load DNS profile: %w", err) }
	if dns != nil { for _, address := range append(dns.A, dns.AAAA...) { result.ips[address] = true } }
	health, err := store.ListHealthSnapshots(domainID, time.Now().Add(-24*time.Hour))
	if err != nil { return result, fmt.Errorf("load health profile: %w", err) }
	if len(health) > 0 { result.status = health[len(health)-1].Status }
	latency, err := store.ListLatencySamples(domainID, time.Now().Add(-24*time.Hour))
	if err != nil { return result, fmt.Errorf("load latency profile: %w", err) }
	for index := len(latency)-1; index >= 0; index-- { if latency[index].Success { result.latency = latency[index].LatencyMs; break } }
	return result, nil
}

func compare(left, right profile) (float64, []string) {
	score := 0.0
	reasons := make([]string, 0)
	if left.cdn != "" && left.cdn == right.cdn { score += 0.30; reasons = append(reasons, "same CDN provider") }
	if overlaps(left.asns, right.asns) { score += 0.30; reasons = append(reasons, "shared origin ASN") }
	if overlaps(left.ips, right.ips) { score += 0.20; reasons = append(reasons, "shared resolved IP") }
	if left.status != "" && left.status == right.status { score += 0.10; reasons = append(reasons, "same health status") }
	if left.latency > 0 && right.latency > 0 && abs(left.latency-right.latency) <= 50 { score += 0.10; reasons = append(reasons, "similar recent latency") }
	if len(reasons) == 0 { reasons = append(reasons, "no current network signals overlap") }
	return score, reasons
}

func overlaps(left, right map[string]bool) bool { for value := range left { if right[value] { return true } }; return false }
func abs(value float64) float64 { if value < 0 { return -value }; return value }