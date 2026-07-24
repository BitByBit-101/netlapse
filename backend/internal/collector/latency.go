package collector

import (
	"log"
	"net"
	"time"

	"netlapse/internal/storage"
)

// MeasureLatency times a TCP handshake to domain:443. This avoids needing
// raw-socket / ICMP privileges that plain ICMP ping requires, while still
// giving a meaningful, comparable latency signal over time.
func MeasureLatency(domain string) storage.LatencySample {
	sample := storage.LatencySample{CapturedAt: time.Now().UTC()}

	start := time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(domain, "443"), 5*time.Second)
	elapsed := time.Since(start)

	if err != nil {
		sample.Success = false
		sample.Error = err.Error()
		return sample
	}
	defer conn.Close()

	sample.Success = true
	sample.LatencyMs = float64(elapsed.Microseconds()) / 1000.0
	return sample
}

// RunLatencyCollector periodically measures latency for every tracked domain.
func RunLatencyCollector(store *storage.Storage, interval time.Duration) {
	tick := func() {
		domains, err := store.ListDomains()
		if err != nil {
			log.Printf("latency collector: list domains: %v", err)
			return
		}
		for _, d := range domains {
			sample := MeasureLatency(d.Name)
			if err := store.InsertLatencySample(d.ID, sample); err != nil {
				log.Printf("latency collector: insert sample for %s: %v", d.Name, err)
			}
		}
	}

	tick()
	ticker := time.NewTicker(interval)
	for range ticker.C {
		tick()
	}
}
