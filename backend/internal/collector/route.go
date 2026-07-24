package collector

import (
	"context"
	"log"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"netlapse/internal/storage"
)

var (
	hopLinePattern = regexp.MustCompile(`^\s*(\d+)\s+(.+)$`)
	ipv4Pattern    = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	// IPv6 hops were previously invisible: the address regex was IPv4-only, so
	// on any v6 path every hop parsed with an empty address and the topology
	// rendered as a row of anonymous nodes. Matches bare v6 forms including the
	// "::" compressed notation traceroute emits.
	ipv6Pattern = regexp.MustCompile(`\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b`)
	// Accepts decimals: Linux traceroute prints "12.345 ms", and the previous
	// integer-only pattern silently truncated every one of those samples.
	latencyPattern = regexp.MustCompile(`([\d.]+)\s*ms`)
)

// hopOwnerCache memoises Cymru lookups across collector ticks. Backbone routers
// are extremely stable and appear in every trace to every domain, so without a
// cache each pass would re-resolve the same dozen IPs forever.
var (
	hopOwnerCache   = map[string]storage.ASNEntry{}
	hopOwnerCacheMu sync.Mutex
)

func hopOwner(ip string) (storage.ASNEntry, bool) {
	hopOwnerCacheMu.Lock()
	if entry, ok := hopOwnerCache[ip]; ok {
		hopOwnerCacheMu.Unlock()
		return entry, entry.ASN != ""
	}
	hopOwnerCacheMu.Unlock()

	entry, err := asnForIP(ip)
	if err != nil {
		entry = storage.ASNEntry{IP: ip} // cache the miss too, so we stop retrying
	}
	hopOwnerCacheMu.Lock()
	hopOwnerCache[ip] = entry
	hopOwnerCacheMu.Unlock()
	return entry, err == nil && entry.ASN != ""
}

// isPrivateAddress reports whether an address has no public owner, so it can be
// labelled locally instead of being looked up.
func isPrivateAddress(ip net.IP) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// annotateOwnership fills in who operates each responding hop. Lookups run
// concurrently because they're independent DNS round-trips; serially, a 12-hop
// trace would add roughly a second per hop to every collection pass.
func annotateOwnership(hops []storage.RouteHop) {
	var wg sync.WaitGroup
	for index := range hops {
		hop := &hops[index]
		if hop.Address == "" {
			continue
		}
		parsed := net.ParseIP(hop.Address)
		if parsed == nil {
			continue
		}
		if isPrivateAddress(parsed) {
			hop.Private = true
			hop.ASName = "Private network"
			continue
		}
		wg.Add(1)
		go func(target *storage.RouteHop) {
			defer wg.Done()
			if entry, ok := hopOwner(target.Address); ok {
				target.ASN = entry.ASN
				target.ASName = entry.ASName
				target.Country = entry.Country
			}
		}(hop)
	}
	wg.Wait()
}

// CollectRoute runs the platform traceroute command and records the visible hops,
// annotated with the network that operates each one.
func CollectRoute(domain string) storage.RouteSnapshot {
	snapshot := storage.RouteSnapshot{CapturedAt: time.Now().UTC()}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		command = exec.CommandContext(ctx, "tracert", "-d", "-h", "12", "-w", "1500", domain)
	} else {
		command = exec.CommandContext(ctx, "traceroute", "-n", "-m", "12", "-w", "2", domain)
	}

	output, err := command.CombinedOutput()
	snapshot.Hops = parseRouteOutput(string(output))
	if ctx.Err() != nil {
		snapshot.Error = "traceroute timed out"
		return snapshot
	}
	if err != nil {
		snapshot.Error = strings.TrimSpace(string(output))
		if snapshot.Error == "" {
			snapshot.Error = err.Error()
		}
		return snapshot
	}
	if len(snapshot.Hops) == 0 {
		snapshot.Error = "traceroute returned no hops"
		return snapshot
	}
	annotateOwnership(snapshot.Hops)
	snapshot.Success = true
	return snapshot
}

func parseRouteOutput(output string) []storage.RouteHop {
	hops := make([]storage.RouteHop, 0)
	for _, line := range strings.Split(output, "\n") {
		// Windows terminates lines with CRLF; a trailing \r would otherwise end
		// up glued to the parsed address.
		line = strings.TrimRight(line, "\r")
		matches := hopLinePattern.FindStringSubmatch(line)
		if len(matches) != 3 {
			continue
		}
		hopNumber, err := strconv.Atoi(matches[1])
		if err != nil {
			continue
		}
		body := matches[2]

		hop := storage.RouteHop{Hop: hopNumber}

		// Try IPv6 first: an IPv4 pattern can match a fragment of a mixed
		// v4-in-v6 form, whereas the reverse is not true.
		if ip := ipv6Pattern.FindString(body); ip != "" && strings.Contains(ip, ":") {
			hop.Address = ip
		} else if ip := ipv4Pattern.FindString(body); ip != "" {
			hop.Address = ip
		}

		latencies := make([]float64, 0, 3)
		for _, match := range latencyPattern.FindAllStringSubmatch(body, -1) {
			if value, err := strconv.ParseFloat(match[1], 64); err == nil {
				latencies = append(latencies, value)
			}
		}

		// Each "*" is one lost probe. Counting them — rather than asking whether
		// the line contains any "*" at all — is what separates a hop that lost
		// every probe from one that lost some. The old boolean flagged hops as
		// timed out while simultaneously reporting a valid latency for them.
		lost := strings.Count(body, "*")
		hop.ProbesLost = lost
		hop.ProbesSent = lost + len(latencies)
		hop.TimedOut = len(latencies) == 0

		if len(latencies) > 0 {
			total, low, high := 0.0, latencies[0], latencies[0]
			for _, value := range latencies {
				total += value
				if value < low {
					low = value
				}
				if value > high {
					high = value
				}
			}
			// Average only the probes that answered. Previously lost probes
			// contributed 0 ms, pulling reported latency below reality.
			hop.LatencyMs = total / float64(len(latencies))
			hop.MinLatencyMs = low
			hop.MaxLatencyMs = high
		}

		hops = append(hops, hop)
	}
	return hops
}

// RunRouteCollector periodically captures the path to every tracked domain.
func RunRouteCollector(store *storage.Storage, interval time.Duration) {
	tick := func() {
		domains, err := store.ListDomains()
		if err != nil {
			log.Printf("route collector: list domains: %v", err)
			return
		}
		for _, domain := range domains {
			snapshot := CollectRoute(domain.Name)
			if err := store.InsertRouteSnapshot(domain.ID, snapshot); err != nil {
				log.Printf("route collector: insert snapshot for %s: %v", domain.Name, err)
			}
		}
	}

	tick()
	ticker := time.NewTicker(interval)
	for range ticker.C {
		tick()
	}
}