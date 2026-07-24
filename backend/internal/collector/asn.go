package collector

import (
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	"netlapse/internal/storage"
)

// asnForIP looks up ASN ownership for an IPv4 or IPv6 address using Team
// Cymru's DNS-based whois service. This needs no API key and no HTTP calls —
// just two TXT lookups against Cymru's own DNS zone, which mirrors the global
// routing table (BGP) daily.
// See https://team-cymru.com/community-services/ip-asn-mapping/
func asnForIP(ip string) (storage.ASNEntry, error) {
	entry := storage.ASNEntry{IP: ip}

	parsed := net.ParseIP(ip)
	if parsed == nil {
		return entry, fmt.Errorf("not an IP address: %s", ip)
	}

	var zone string
	if v4 := parsed.To4(); v4 != nil {
		octets := strings.Split(v4.String(), ".")
		zone = fmt.Sprintf("%s.%s.%s.%s.origin.asn.cymru.com", octets[3], octets[2], octets[1], octets[0])
	} else {
		// IPv6 lives in a separate Cymru zone keyed by nibble-reversed digits.
		// Without this, every hop on a v6 path had no owner — and v6 paths are
		// the common case on many consumer connections.
		zone = reverseNibbles(parsed) + ".origin6.asn.cymru.com"
	}

	// Query 1 — the origin zone TXT returns:
	// "ASN | BGP prefix | country | registry | allocation date"
	originRecords, err := net.LookupTXT(zone)
	if err != nil || len(originRecords) == 0 {
		return entry, fmt.Errorf("origin lookup for %s: %w", ip, err)
	}
	fields := splitPipeFields(originRecords[0])
	if len(fields) >= 5 {
		entry.ASN = fields[0]
		entry.Prefix = fields[1]
		entry.Country = fields[2]
		entry.Registry = fields[3]
		entry.Allocated = fields[4]
	}

	// Query 2 — "ASN.asn.cymru.com" TXT returns the human-readable org name:
	// "ASN | country | registry | allocation date | AS Name"
	if entry.ASN != "" {
		if asRecords, err := net.LookupTXT("AS" + entry.ASN + ".asn.cymru.com"); err == nil && len(asRecords) > 0 {
			asFields := splitPipeFields(asRecords[0])
			if len(asFields) >= 5 {
				entry.ASName = asFields[4]
			}
		}
	}

	return entry, nil
}

// reverseNibbles renders an IPv6 address as dot-separated hex nibbles in
// reverse order, the key format Cymru's origin6 zone expects:
// 2001:db8::1 becomes "1.0.0.0.….8.b.d.0.1.0.0.2".
func reverseNibbles(ip net.IP) string {
	v6 := ip.To16()
	const hex = "0123456789abcdef"
	parts := make([]string, 0, 32)
	for index := len(v6) - 1; index >= 0; index-- {
		parts = append(parts, string(hex[v6[index]&0x0f]), string(hex[v6[index]>>4]))
	}
	return strings.Join(parts, ".")
}

func splitPipeFields(s string) []string {
	parts := strings.Split(s, "|")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

// CollectASN resolves a domain's current addresses and looks up ASN ownership
// for each one. Both IPv4 and IPv6 are covered now that asnForIP handles the
// origin6 zone; previously v6-only domains produced no ownership data at all.
func CollectASN(domain string) []storage.ASNEntry {
	ips, err := net.LookupIP(domain)
	if err != nil {
		return nil
	}

	var entries []storage.ASNEntry
	for _, ip := range ips {
		if entry, err := asnForIP(ip.String()); err == nil {
			entries = append(entries, entry)
		}
	}
	return entries
}

// sameASN compares two capture passes by origin ASN and announced prefix.
func sameASN(a, b []storage.ASNEntry) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]storage.ASNEntry{}
	for _, e := range a {
		seen[e.IP] = e
	}
	for _, e := range b {
		previous, ok := seen[e.IP]
		if !ok || previous.ASN != e.ASN || previous.Prefix != e.Prefix {
			return false
		}
	}
	return true
}

// RunASNCollector periodically re-resolves ASN ownership for every tracked
// domain's IPs, storing a new snapshot only when ownership actually changes
// (an IP moving from one ASN/organization to another).
func RunASNCollector(store *storage.Storage, interval time.Duration) {
	tick := func() {
		domains, err := store.ListDomains()
		if err != nil {
			log.Printf("asn collector: list domains: %v", err)
			return
		}
		for _, d := range domains {
			entries := CollectASN(d.Name)
			if len(entries) == 0 {
				continue
			}
			last, err := store.LatestASNSnapshot(d.ID)
			if err != nil {
				log.Printf("asn collector: latest snapshot for %s: %v", d.Name, err)
				continue
			}
			if last != nil && sameASN(last.Entries, entries) {
				events, err := store.ListBGPEvents(d.ID)
				if err != nil {
					log.Printf("asn collector: list BGP events for %s: %v", d.Name, err)
					continue
				}
				if len(events) == 0 {
					capturedAt := time.Now().UTC()
					if err := store.InsertBGPEvents(d.ID, DetectBGPEvents(nil, entries, capturedAt)); err != nil {
						log.Printf("asn collector: insert BGP baseline for %s: %v", d.Name, err)
					}
				}
				continue
			}
			capturedAt := time.Now().UTC()
			if err := store.InsertASNSnapshot(d.ID, capturedAt, entries); err != nil {
				log.Printf("asn collector: insert snapshot for %s: %v", d.Name, err)
				continue
			}
			var previous []storage.ASNEntry
			if last != nil {
				previous = last.Entries
			}
			if err := store.InsertBGPEvents(d.ID, DetectBGPEvents(previous, entries, capturedAt)); err != nil {
				log.Printf("asn collector: insert BGP events for %s: %v", d.Name, err)
			}
			log.Printf("asn collector: new snapshot recorded for %s", d.Name)
		}
	}

	tick()
	ticker := time.NewTicker(interval)
	for range ticker.C {
		tick()
	}
}
