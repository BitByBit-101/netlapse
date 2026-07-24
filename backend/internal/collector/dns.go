package collector

import (
	"log"
	"net"
	"sort"
	"time"

	"netlapse/internal/storage"
)

// CollectDNS resolves the current DNS state for a domain.
func CollectDNS(domain string) storage.DNSSnapshot {
	snap := storage.DNSSnapshot{CapturedAt: time.Now().UTC()}

	if ips, err := net.LookupIP(domain); err == nil {
		for _, ip := range ips {
			if ip.To4() != nil {
				snap.A = append(snap.A, ip.String())
			} else {
				snap.AAAA = append(snap.AAAA, ip.String())
			}
		}
	}

	if cname, err := net.LookupCNAME(domain); err == nil {
		snap.CNAME = cname
	}

	if nsRecords, err := net.LookupNS(domain); err == nil {
		for _, ns := range nsRecords {
			snap.NS = append(snap.NS, ns.Host)
		}
	}

	if mxRecords, err := net.LookupMX(domain); err == nil {
		for _, mx := range mxRecords {
			snap.MX = append(snap.MX, mx.Host)
		}
	}

	if txtRecords, err := net.LookupTXT(domain); err == nil {
		snap.TXT = txtRecords
	}

	sort.Strings(snap.A)
	sort.Strings(snap.AAAA)
	sort.Strings(snap.NS)
	sort.Strings(snap.MX)
	sort.Strings(snap.TXT)

	return snap
}

// sameRecords compares two snapshots ignoring the timestamp/id, to decide
// whether a new one is actually worth storing (git-commit-style: only
// snapshot on change).
func sameRecords(a, b storage.DNSSnapshot) bool {
	return equalStrings(a.A, b.A) &&
		equalStrings(a.AAAA, b.AAAA) &&
		a.CNAME == b.CNAME &&
		equalStrings(a.NS, b.NS) &&
		equalStrings(a.MX, b.MX) &&
		equalStrings(a.TXT, b.TXT)
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// RunDNSCollector periodically resolves DNS for every tracked domain and
// stores a new snapshot only when the records changed since the last one.
func RunDNSCollector(store *storage.Storage, interval time.Duration) {
	tick := func() {
		domains, err := store.ListDomains()
		if err != nil {
			log.Printf("dns collector: list domains: %v", err)
			return
		}
		for _, d := range domains {
			snap := CollectDNS(d.Name)
			last, err := store.LatestDNSSnapshot(d.ID)
			if err != nil {
				log.Printf("dns collector: latest snapshot for %s: %v", d.Name, err)
				continue
			}
			if last != nil && sameRecords(*last, snap) {
				continue // no change, don't clutter history
			}
			if err := store.InsertDNSSnapshot(d.ID, snap); err != nil {
				log.Printf("dns collector: insert snapshot for %s: %v", d.Name, err)
				continue
			}
			log.Printf("dns collector: new snapshot recorded for %s", d.Name)
		}
	}

	tick() // run immediately on startup
	ticker := time.NewTicker(interval)
	for range ticker.C {
		tick()
	}
}
