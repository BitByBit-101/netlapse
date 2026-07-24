package collector

import (
	"log"
	"time"

	"netlapse/internal/storage"
)

// BuildHealthSnapshot converts recent connection samples into an availability status.
func BuildHealthSnapshot(samples []storage.LatencySample, capturedAt time.Time) *storage.HealthSnapshot {
	if len(samples) == 0 {
		return nil
	}

	successes := 0
	var totalLatency float64
	for _, sample := range samples {
		if sample.Success {
			successes++
			totalLatency += sample.LatencyMs
		}
	}

	snapshot := &storage.HealthSnapshot{
		CapturedAt:  capturedAt.UTC(),
		SuccessRate: float64(successes) / float64(len(samples)),
		Status:      "outage",
	}
	if successes > 0 {
		snapshot.AverageLatencyMs = totalLatency / float64(successes)
	}
	switch {
	case snapshot.SuccessRate >= 0.9 && snapshot.AverageLatencyMs < 250:
		snapshot.Status = "healthy"
	case snapshot.SuccessRate >= 0.5:
		snapshot.Status = "degraded"
	}
	return snapshot
}

// RunHealthCollector records a rolling health status based on the last 15 minutes of latency samples.
func RunHealthCollector(store *storage.Storage, interval time.Duration) {
	tick := func() {
		domains, err := store.ListDomains()
		if err != nil {
			log.Printf("health collector: list domains: %v", err)
			return
		}
		now := time.Now().UTC()
		for _, domain := range domains {
			samples, err := store.ListLatencySamples(domain.ID, now.Add(-15*time.Minute))
			if err != nil {
				log.Printf("health collector: list samples for %s: %v", domain.Name, err)
				continue
			}
			snapshot := BuildHealthSnapshot(samples, now)
			if snapshot == nil {
				continue
			}
			if err := store.InsertHealthSnapshot(domain.ID, *snapshot); err != nil {
				log.Printf("health collector: insert snapshot for %s: %v", domain.Name, err)
			}
		}
	}

	tick()
	ticker := time.NewTicker(interval)
	for range ticker.C {
		tick()
	}
}