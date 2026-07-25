package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"netlapse/internal/api"
	"netlapse/internal/collector"
	"netlapse/internal/storage"
)

func main() {
	dbPath := getEnv("NC_DB_PATH", "netlapse.db")
	addr := getEnv("NC_ADDR", ":8080")
	dnsInterval := getEnvDuration("NC_DNS_INTERVAL", 10*time.Minute)
	latencyInterval := getEnvDuration("NC_LATENCY_INTERVAL", 30*time.Second)
	cdnInterval := getEnvDuration("NC_CDN_INTERVAL", 15*time.Minute)
	asnInterval := getEnvDuration("NC_ASN_INTERVAL", 30*time.Minute)
	tlsInterval := getEnvDuration("NC_TLS_INTERVAL", 30*time.Minute)
	routeInterval := getEnvDuration("NC_ROUTE_INTERVAL", 6*time.Hour)
	healthInterval := getEnvDuration("NC_HEALTH_INTERVAL", 2*time.Minute)

	store, err := storage.New(dbPath)
	if err != nil {
		log.Fatalf("failed to open storage: %v", err)
	}
	defer store.Close()

	go collector.RunDNSCollector(store, dnsInterval)
	go collector.RunLatencyCollector(store, latencyInterval)
	go collector.RunCDNCollector(store, cdnInterval)
	go collector.RunASNCollector(store, asnInterval)
	go collector.RunTLSCollector(store, tlsInterval)
	go collector.RunRouteCollector(store, routeInterval)
	go collector.RunHealthCollector(store, healthInterval)

	handler := api.NewRouter(store)
	log.Printf("netlapse API listening on %s (db=%s, dns_interval=%s, latency_interval=%s)",
		addr, dbPath, dnsInterval, latencyInterval)
	log.Fatal(http.ListenAndServe(addr, handler))
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
