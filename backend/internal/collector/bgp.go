package collector

import (
	"time"

	"netlapse/internal/storage"
)

// DetectBGPEvents compares Team Cymru routing observations across two capture passes.
func DetectBGPEvents(previous, current []storage.ASNEntry, capturedAt time.Time) []storage.BGPEvent {
	previousByIP := make(map[string]storage.ASNEntry, len(previous))
	currentByIP := make(map[string]storage.ASNEntry, len(current))
	for _, entry := range previous {
		previousByIP[entry.IP] = entry
	}
	for _, entry := range current {
		currentByIP[entry.IP] = entry
	}

	events := make([]storage.BGPEvent, 0)
	for ip, entry := range currentByIP {
		before, existed := previousByIP[ip]
		if !existed {
			events = append(events, storage.BGPEvent{CapturedAt: capturedAt, EventType: "origin_announced", IP: ip, CurrentASN: entry.ASN, CurrentPrefix: entry.Prefix})
			continue
		}
		if before.ASN != entry.ASN {
			events = append(events, storage.BGPEvent{CapturedAt: capturedAt, EventType: "origin_changed", IP: ip, PreviousASN: before.ASN, CurrentASN: entry.ASN, PreviousPrefix: before.Prefix, CurrentPrefix: entry.Prefix})
		} else if before.Prefix != entry.Prefix {
			events = append(events, storage.BGPEvent{CapturedAt: capturedAt, EventType: "prefix_changed", IP: ip, PreviousASN: before.ASN, CurrentASN: entry.ASN, PreviousPrefix: before.Prefix, CurrentPrefix: entry.Prefix})
		}
	}
	for ip, entry := range previousByIP {
		if _, exists := currentByIP[ip]; !exists {
			events = append(events, storage.BGPEvent{CapturedAt: capturedAt, EventType: "origin_withdrawn", IP: ip, PreviousASN: entry.ASN, PreviousPrefix: entry.Prefix})
		}
	}
	return events
}