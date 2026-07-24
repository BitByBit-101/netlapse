package collector

import (
	"net"
	"testing"
)

// Real Windows tracert output on an IPv6 path. Every address here parsed as ""
// before the v6 pattern existed, which is why the topology view rendered
// anonymous nodes.
const windowsIPv6 = "\r\nTracing route to google.com [2404:6800:4000:1017::8a]\r\nover a maximum of 12 hops:\r\n\r\n  1     4 ms     3 ms     5 ms  2401:4900:c93a:a8f0::c3 \r\n  2    62 ms    51 ms    32 ms  2401:4900:1:a829::2 \r\n  5     *        *        *     Request timed out.\r\n  9   328 ms   144 ms   135 ms  2404:6800:8201:100::1 \r\n\r\nTrace complete.\r\n"

// A hop that answered two probes and lost one. The old parser marked this
// TimedOut because the line contains a "*", while still reporting a latency.
const partialLoss = "  7    74 ms     *    84 ms  192.168.1.1\r\n"

// Linux traceroute: decimal milliseconds, which the integer-only pattern missed.
const linuxDecimal = " 3  10.0.0.1  12.345 ms  13.500 ms  11.000 ms\n"

func TestParsesIPv6Addresses(t *testing.T) {
	hops := parseRouteOutput(windowsIPv6)
	if len(hops) != 4 {
		t.Fatalf("expected 4 hops, got %d", len(hops))
	}
	if hops[0].Address != "2401:4900:c93a:a8f0::c3" {
		t.Errorf("hop 1 address = %q, want the IPv6 address", hops[0].Address)
	}
	if hops[0].LatencyMs != 4 {
		t.Errorf("hop 1 latency = %v, want 4 (mean of 4,3,5)", hops[0].LatencyMs)
	}
	if hops[3].Address != "2404:6800:8201:100::1" {
		t.Errorf("hop 9 address = %q", hops[3].Address)
	}
}

func TestFullTimeoutHasNoLatency(t *testing.T) {
	hops := parseRouteOutput(windowsIPv6)
	timeout := hops[2]
	if !timeout.TimedOut {
		t.Error("a hop losing every probe must be TimedOut")
	}
	if timeout.LatencyMs != 0 {
		t.Errorf("fully timed-out hop reported %v ms", timeout.LatencyMs)
	}
	if timeout.ProbesLost != 3 {
		t.Errorf("ProbesLost = %d, want 3", timeout.ProbesLost)
	}
}

func TestPartialLossIsNotATimeout(t *testing.T) {
	hops := parseRouteOutput(partialLoss)
	if len(hops) != 1 {
		t.Fatalf("expected 1 hop, got %d", len(hops))
	}
	hop := hops[0]
	if hop.TimedOut {
		t.Error("a hop that answered 2 of 3 probes must NOT be TimedOut")
	}
	if hop.ProbesLost != 1 || hop.ProbesSent != 3 {
		t.Errorf("lost=%d sent=%d, want 1 and 3", hop.ProbesLost, hop.ProbesSent)
	}
	// Mean of the answered probes only: (74+84)/2 = 79. Averaging the lost
	// probe in as 0 would give 52.7.
	if hop.LatencyMs != 79 {
		t.Errorf("latency = %v, want 79 (mean of answered probes)", hop.LatencyMs)
	}
	if hop.Address != "192.168.1.1" {
		t.Errorf("address = %q", hop.Address)
	}
}

func TestDecimalLatencyAndJitter(t *testing.T) {
	hops := parseRouteOutput(linuxDecimal)
	if len(hops) != 1 {
		t.Fatalf("expected 1 hop, got %d", len(hops))
	}
	hop := hops[0]
	if hop.MinLatencyMs != 11.0 || hop.MaxLatencyMs != 13.5 {
		t.Errorf("min/max = %v/%v, want 11/13.5", hop.MinLatencyMs, hop.MaxLatencyMs)
	}
	// Truncating decimals would yield 12 exactly; the real mean is 12.281667.
	if hop.LatencyMs < 12.28 || hop.LatencyMs > 12.29 {
		t.Errorf("latency = %v, want ~12.2817", hop.LatencyMs)
	}
}

func TestReverseNibblesMatchesCymruFormat(t *testing.T) {
	// Documented example: 2001:4860:4860::8888 (Google DNS).
	ip := net.ParseIP("2001:4860:4860::8888")
	got := reverseNibbles(ip)
	// All 32 nibbles of the expanded address, least-significant first.
	want := "8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2"
	if got != want {
		t.Errorf("reverseNibbles mismatch\n got: %s\nwant: %s", got, want)
	}
}

func TestASNLookupResolvesIPv6(t *testing.T) {
	if testing.Short() {
		t.Skip("needs network")
	}
	entry, err := asnForIP("2001:4860:4860::8888")
	if err != nil {
		t.Fatalf("IPv6 ASN lookup failed: %v", err)
	}
	if entry.ASN != "15169" {
		t.Errorf("ASN = %q, want 15169 (Google)", entry.ASN)
	}
	if entry.ASName == "" {
		t.Error("ASName is empty")
	}
	t.Logf("resolved: AS%s %s prefix=%s", entry.ASN, entry.ASName, entry.Prefix)
}
