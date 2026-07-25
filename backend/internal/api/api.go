package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"netlapse/internal/collector"
	"netlapse/internal/events"
	"netlapse/internal/investigator"
	"netlapse/internal/llm"
	"netlapse/internal/predictor"
	"netlapse/internal/similarity"
	"netlapse/internal/storage"
)

// NewRouter builds the HTTP mux for the netlapse API.
func NewRouter(store *storage.Storage) http.Handler {
	mux := http.NewServeMux()
	llmClient := llm.NewFromEnv()

	mux.HandleFunc("/api/domains", withCORS(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			domains, err := store.ListDomains()
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, domains)
		case http.MethodPost:
			var body struct {
				Domain string `json:"domain"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Domain) == "" {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			id, err := store.GetOrCreateDomain(strings.ToLower(strings.TrimSpace(body.Domain)))
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			// Kick off an immediate first snapshot/sample for every collector so
			// the UI has data right away instead of waiting for the next tick.
			go func(domainID int64, name string) {
				snap := collector.CollectDNS(name)
				_ = store.InsertDNSSnapshot(domainID, snap)

				sample := collector.MeasureLatency(name)
				_ = store.InsertLatencySample(domainID, sample)
				if health := collector.BuildHealthSnapshot([]storage.LatencySample{sample}, time.Now().UTC()); health != nil {
					_ = store.InsertHealthSnapshot(domainID, *health)
				}

				route := collector.CollectRoute(name)
				_ = store.InsertRouteSnapshot(domainID, route)

				// Only record the baseline if the probe actually learned
				// something; a failure here would otherwise be stored as this
				// domain's starting provider.
				if cdnSnap, err := collector.DetectCDN(name); err == nil {
					_ = store.InsertCDNSnapshot(domainID, cdnSnap)
				}

				if entries := collector.CollectASN(name); len(entries) > 0 {
					_ = store.InsertASNSnapshot(domainID, time.Now().UTC(), entries)
				}

				if tlsSnap, err := collector.CollectTLS(name); err == nil {
					_ = store.InsertTLSSnapshot(domainID, tlsSnap)
				}
			}(id, body.Domain)
			writeJSON(w, map[string]any{"id": id, "name": body.Domain})
		default:
			writeErr(w, http.StatusMethodNotAllowed, nil)
		}
	}))

	// Registered separately from "/api/domains": Go's ServeMux treats a pattern
	// without a trailing slash as an exact match, so a subtree pattern is needed
	// for the per-domain path.
	mux.HandleFunc("/api/domains/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeErr(w, http.StatusMethodNotAllowed, nil)
			return
		}
		name := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/domains/")))
		if name == "" || strings.Contains(name, "/") {
			writeErr(w, http.StatusBadRequest, errors.New("domain required"))
			return
		}
		existed, err := store.DeleteDomain(name)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		if !existed {
			writeErr(w, http.StatusNotFound, errors.New("domain not tracked: "+name))
			return
		}
		// The collectors re-read the domain list every tick, so no extra
		// signalling is needed to stop them recording this domain.
		writeJSON(w, map[string]any{"deleted": name})
	}))

	mux.HandleFunc("/api/similar/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/similar/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		matches, err := similarity.Find(store, id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, matches)
	}))

	mux.HandleFunc("/api/predict/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/predict/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		forecast, err := predictor.Build(store, domain, id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, forecast)
	}))

	mux.HandleFunc("/api/events/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/events/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		since := time.Now().Add(-7 * 24 * time.Hour)
		if rangeParam := r.URL.Query().Get("since_hours"); rangeParam != "" {
			if hours, err := strconv.Atoi(rangeParam); err == nil {
				since = time.Now().Add(-time.Duration(hours) * time.Hour)
			}
		}
		feed, err := events.Build(store, id, since)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, feed)
	}))

	mux.HandleFunc("/api/investigate/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/investigate/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		report, err := investigator.Analyze(store, domain, id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		if llmClient != nil {
			narrative, err := llmClient.Summarize(r.Context(), report)
			if err != nil {
				report.LLMStatus = "unavailable"
				report.LLMError = err.Error()
			} else {
				report.Narrative = narrative
				report.LLMModel = llmClient.Model()
				report.LLMStatus = "ready"
			}
		}
		writeJSON(w, report)
	}))

	mux.HandleFunc("/api/history/route/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/route/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		snapshots, err := store.ListRouteSnapshots(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, snapshots)
	}))

	mux.HandleFunc("/api/history/health/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/health/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		since := time.Now().Add(-7 * 24 * time.Hour)
		if rangeParam := r.URL.Query().Get("since_hours"); rangeParam != "" {
			if hours, err := strconv.Atoi(rangeParam); err == nil {
				since = time.Now().Add(-time.Duration(hours) * time.Hour)
			}
		}
		snapshots, err := store.ListHealthSnapshots(id, since)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, snapshots)
	}))

	mux.HandleFunc("/api/history/bgp/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/bgp/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		events, err := store.ListBGPEvents(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, events)
	}))

	mux.HandleFunc("/api/history/dns/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/dns/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		snaps, err := store.ListDNSSnapshots(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, snaps)
	}))

	mux.HandleFunc("/api/history/latency/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/latency/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		since := time.Now().Add(-24 * time.Hour)
		if rangeParam := r.URL.Query().Get("since_hours"); rangeParam != "" {
			if hrs, err := strconv.Atoi(rangeParam); err == nil {
				since = time.Now().Add(-time.Duration(hrs) * time.Hour)
			}
		}
		samples, err := store.ListLatencySamples(id, since)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, samples)
	}))

	mux.HandleFunc("/api/history/cdn/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/cdn/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		snaps, err := store.ListCDNSnapshots(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, snaps)
	}))

	mux.HandleFunc("/api/history/asn/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/asn/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		snaps, err := store.ListASNSnapshots(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, snaps)
	}))

	mux.HandleFunc("/api/history/tls/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		domain := strings.TrimPrefix(r.URL.Path, "/api/history/tls/")
		if domain == "" {
			writeErr(w, http.StatusBadRequest, nil)
			return
		}
		id, err := store.DomainIDByName(domain)
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		snaps, err := store.ListTLSSnapshots(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, snaps)
	}))

	return mux
}

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h(w, r)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	msg := http.StatusText(status)
	if err != nil {
		msg = err.Error()
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
