package collector

import (
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"netlapse/internal/storage"
)

// userAgent identifies the collector honestly instead of impersonating a
// browser. A WAF that dislikes it still answers with its own edge headers,
// which is all detection actually needs.
const userAgent = "netlapse/0.1 (network history collector)"

type headerCheck struct {
	header   string
	contains string // "" means "header just needs to be present"
}

type cdnSignature struct {
	provider     string
	cnameSuffix  []string
	headerChecks []headerCheck
	// asnHints match against Team Cymru's AS name. Last resort only: an ASN
	// says who owns the address, which is a weaker claim than an edge header,
	// so these are consulted after everything else has failed.
	asnHints []string
}

// Known CDN/edge fingerprints. Checked in order; first match wins.
var cdnSignatures = []cdnSignature{
	{provider: "Cloudflare", cnameSuffix: []string{"cloudflare.net", "cdn.cloudflare.net"},
		headerChecks: []headerCheck{{"Cf-Ray", ""}, {"Cf-Cache-Status", ""}, {"Server", "cloudflare"}},
		asnHints:     []string{"cloudflare"}},
	{provider: "Akamai", cnameSuffix: []string{"akamaiedge.net", "akamai.net", "akamaitechnologies.com", "akadns.net", "edgekey.net", "edgesuite.net"},
		headerChecks: []headerCheck{{"Server", "akamaighost"}, {"X-Akamai-Transformed", ""}, {"Akamai-Grn", ""}},
		asnHints:     []string{"akamai"}},
	{provider: "Fastly", cnameSuffix: []string{"fastly.net", "fastlylb.net"},
		headerChecks: []headerCheck{{"X-Fastly-Request-Id", ""}, {"Server", "fastly"}, {"X-Served-By", "cache-"}},
		asnHints:     []string{"fastly"}},
	{provider: "Amazon CloudFront", cnameSuffix: []string{"cloudfront.net"},
		headerChecks: []headerCheck{{"X-Amz-Cf-Id", ""}, {"Via", "cloudfront"}, {"X-Cache", "cloudfront"}}},
	{provider: "Azure Front Door", cnameSuffix: []string{"azureedge.net", "azurefd.net", "trafficmanager.net"},
		headerChecks: []headerCheck{{"X-Azure-Ref", ""}, {"X-Msedge-Ref", ""}}},
	{provider: "Google", cnameSuffix: []string{"googleusercontent.com", "ghs.google.com", "googlehosted.com"},
		headerChecks: []headerCheck{{"Server", "gws"}, {"Server", "gse"}, {"Server", "golfe2"}, {"Server", "esf"}, {"X-Goog-Generation", ""}},
		asnHints:     []string{"google"}},
	{provider: "Vercel", cnameSuffix: []string{"vercel-dns.com", "vercel.app"},
		headerChecks: []headerCheck{{"Server", "vercel"}, {"X-Vercel-Id", ""}}},
	{provider: "Netlify", cnameSuffix: []string{"netlify.app", "netlifyglobalcdn.com"},
		headerChecks: []headerCheck{{"Server", "netlify"}, {"X-Nf-Request-Id", ""}}},
	{provider: "AWS", cnameSuffix: []string{"elb.amazonaws.com", "awsglobalaccelerator.com"},
		headerChecks: []headerCheck{{"Server", "awselb"}},
		asnHints:     []string{"amazon"}},
	{provider: "Sucuri", headerChecks: []headerCheck{{"X-Sucuri-Id", ""}}},
	{provider: "Imperva", headerChecks: []headerCheck{{"X-Iinfo", ""}, {"X-Cdn", "incapsula"}}},
	{provider: "BunnyCDN", cnameSuffix: []string{"b-cdn.net"}, headerChecks: []headerCheck{{"Server", "bunnycdn"}}},
	{provider: "GitHub", cnameSuffix: []string{"github.io"},
		headerChecks: []headerCheck{{"Server", "github.com"}},
		asnHints:     []string{"github"}},
}

// cnameChain returns the meaningful CNAME targets for a domain.
//
// Go's net.LookupCNAME returns the *queried name itself* when a host has no
// CNAME record ("github.com." for github.com), so a naive suffix check against
// its result silently never matches. Anything equal to the query means the
// absence of a CNAME, not a signal, and is dropped here.
//
// www. is checked too: an apex record can't legally be a CNAME, so on a great
// many sites the CDN alias only exists on the www label.
func cnameChain(domain string) []string {
	var out []string
	for _, host := range []string{domain, "www." + domain} {
		cname, err := net.LookupCNAME(host)
		if err != nil {
			continue
		}
		cname = strings.ToLower(strings.TrimSuffix(cname, "."))
		if cname == "" || cname == strings.ToLower(host) {
			continue
		}
		out = append(out, cname)
	}
	return out
}

// probeHops fetches the domain over HTTPS and returns the response headers of
// every hop, outermost first.
//
// Two deliberate choices:
//   - Redirects are followed manually rather than by http.Client, because the
//     edge answering the first request is frequently NOT the one serving the
//     final page. microsoft.com's 301 carries x-azure-ref; the 200 from
//     www.microsoft.com does not. Auto-following discards the evidence.
//   - GET with a one-byte Range instead of HEAD, because plenty of hosts reject
//     HEAD outright (netflix.com answers 405, "allow: GET, OPTIONS, POST").
//     Servers that ignore Range send a body, which is read and discarded.
func probeHops(domain string) ([]http.Header, error) {
	client := &http.Client{
		Timeout:       10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}

	var hops []http.Header
	target := "https://" + domain + "/"

	for hop := 0; hop < 4; hop++ {
		base, err := url.Parse(target)
		if err != nil {
			return hops, err
		}

		req, err := http.NewRequest(http.MethodGet, target, nil)
		if err != nil {
			return hops, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Range", "bytes=0-0")
		req.Header.Set("Accept", "*/*")

		resp, err := client.Do(req)
		if err != nil {
			return hops, err
		}
		hops = append(hops, resp.Header)
		io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
		resp.Body.Close()

		location := resp.Header.Get("Location")
		if resp.StatusCode < 300 || resp.StatusCode > 399 || location == "" {
			break
		}
		ref, err := url.Parse(location)
		if err != nil {
			break
		}
		next := base.ResolveReference(ref)
		if next.Scheme != "http" && next.Scheme != "https" {
			break
		}
		target = next.String()
	}

	return hops, nil
}

// matchHeaders looks for a fingerprint across the hops, outermost first, so the
// edge closest to the client wins over an origin further back.
func matchHeaders(hops []http.Header) (provider, via, evidence string) {
	for _, header := range hops {
		for _, sig := range cdnSignatures {
			for _, hc := range sig.headerChecks {
				value := header.Get(hc.header)
				if value == "" {
					continue
				}
				if hc.contains == "" || strings.Contains(strings.ToLower(value), hc.contains) {
					return sig.provider, "header:" + hc.header, value
				}
			}
		}
	}
	return "", "", ""
}

// tidyASName turns Cymru's raw AS name into something a UI column can hold.
// "WIKIMEDIA - Wikimedia Foundation Inc., US" becomes "Wikimedia Foundation
// Inc." — the registry handle and trailing country code are noise once the full
// string is already kept in the evidence field.
func tidyASName(name string) string {
	if index := strings.Index(name, " - "); index >= 0 {
		name = name[index+3:]
	}
	if index := strings.LastIndex(name, ","); index > 0 && len(name)-index <= 5 {
		name = name[:index]
	}
	return strings.TrimSpace(name)
}

// originASN resolves the domain's first IPv4 address to its owning network,
// reusing the Team Cymru lookup the ASN collector already relies on.
func originASN(domain string) (storage.ASNEntry, error) {
	ips, err := net.LookupIP(domain)
	if err != nil {
		return storage.ASNEntry{}, fmt.Errorf("resolve %s: %w", domain, err)
	}
	for _, ip := range ips {
		if ip.To4() == nil {
			continue
		}
		return asnForIP(ip.String())
	}
	return storage.ASNEntry{}, fmt.Errorf("no IPv4 address for %s", domain)
}

// DetectCDN identifies which network is fronting a domain, escalating through
// three signals: CNAME target, then edge response headers, then owning ASN.
//
// The error return matters as much as the snapshot. It is non-nil only when
// every probe failed — meaning "we learned nothing this pass", which is a very
// different fact from "this domain uses no CDN". The collector must not record
// the former as history; conflating the two is what previously made google.com
// appear to change provider seven times when the network merely hiccupped.
func DetectCDN(domain string) (storage.CDNSnapshot, error) {
	snap := storage.CDNSnapshot{CapturedAt: time.Now().UTC(), Provider: "unknown"}

	// 1. CNAME target — the strongest signal when it exists.
	for _, cname := range cnameChain(domain) {
		for _, sig := range cdnSignatures {
			for _, suffix := range sig.cnameSuffix {
				if strings.HasSuffix(cname, suffix) {
					snap.Provider = sig.provider
					snap.DetectedVia = "cname"
					snap.Evidence = cname
					return snap, nil
				}
			}
		}
	}

	// 2. Edge response headers, across every redirect hop.
	hops, probeErr := probeHops(domain)
	if provider, via, evidence := matchHeaders(hops); provider != "" {
		snap.Provider = provider
		snap.DetectedVia = via
		snap.Evidence = evidence
		return snap, nil
	}

	// 3. Owning ASN. Weaker — it names who owns the address rather than proving
	// a CDN sits in front — but "MICROSOFT-CORP-MSN-AS-BLOCK" is a real answer
	// where "unknown" was not.
	entry, asnErr := originASN(domain)
	if asnErr == nil && entry.ASName != "" {
		name := strings.ToLower(entry.ASName)
		for _, sig := range cdnSignatures {
			for _, hint := range sig.asnHints {
				if strings.Contains(name, hint) {
					snap.Provider = sig.provider
					snap.DetectedVia = "asn"
					snap.Evidence = fmt.Sprintf("AS%s %s", entry.ASN, entry.ASName)
					return snap, nil
				}
			}
		}
		// No fingerprint matched, but the operator is known. Report it as
		// self-hosted rather than feigning ignorance.
		snap.Provider = tidyASName(entry.ASName)
		snap.DetectedVia = "asn"
		snap.Evidence = fmt.Sprintf("AS%s %s", entry.ASN, entry.ASName)
		return snap, nil
	}

	// Nothing worked. Distinguish "reachable but unfingerprintable" from
	// "couldn't reach it at all" — only the latter is an error.
	if len(hops) == 0 && asnErr != nil {
		return snap, fmt.Errorf("all probes failed for %s (http: %v; asn: %v)", domain, probeErr, asnErr)
	}

	// Reached it, recognised nothing. A genuine, recordable observation.
	snap.DetectedVia = "no-signal"
	return snap, nil
}

// RunCDNCollector periodically re-detects the CDN for every tracked domain and
// stores a snapshot only when the detected provider genuinely changes.
func RunCDNCollector(store *storage.Storage, interval time.Duration) {
	tick := func() {
		domains, err := store.ListDomains()
		if err != nil {
			log.Printf("cdn collector: list domains: %v", err)
			return
		}
		for _, d := range domains {
			snap, err := DetectCDN(d.Name)
			if err != nil {
				// A probe failure is not a provider change. Log it and leave
				// history untouched rather than writing a phantom event.
				log.Printf("cdn collector: probe failed for %s, skipping: %v", d.Name, err)
				continue
			}
			last, err := store.LatestCDNSnapshot(d.ID)
			if err != nil {
				log.Printf("cdn collector: latest snapshot for %s: %v", d.Name, err)
				continue
			}
			if last != nil && last.Provider == snap.Provider && last.Evidence == snap.Evidence {
				continue
			}
			if err := store.InsertCDNSnapshot(d.ID, snap); err != nil {
				log.Printf("cdn collector: insert snapshot for %s: %v", d.Name, err)
				continue
			}
			log.Printf("cdn collector: new snapshot recorded for %s (%s via %s)", d.Name, snap.Provider, snap.DetectedVia)
		}
	}

	tick()
	ticker := time.NewTicker(interval)
	for range ticker.C {
		tick()
	}
}
