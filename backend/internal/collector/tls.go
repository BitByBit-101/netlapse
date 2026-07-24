package collector

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"time"

	"netlapse/internal/storage"
)

var tlsVersionNames = map[uint16]string{
	tls.VersionTLS10: "TLS 1.0",
	tls.VersionTLS11: "TLS 1.1",
	tls.VersionTLS12: "TLS 1.2",
	tls.VersionTLS13: "TLS 1.3",
}

// CollectTLS connects to domain:443 and inspects the leaf certificate the
// server presents — issuer, validity window, serial number, and the TLS
// version/cipher suite actually negotiated.
func CollectTLS(domain string) (storage.TLSSnapshot, error) {
	snap := storage.TLSSnapshot{CapturedAt: time.Now().UTC()}

	dialer := &net.Dialer{Timeout: 6 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", domain+":443", &tls.Config{ServerName: domain})
	if err != nil {
		return snap, err
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return snap, fmt.Errorf("server presented no certificate")
	}
	cert := state.PeerCertificates[0]

	snap.Issuer = cert.Issuer.CommonName
	snap.Subject = cert.Subject.CommonName
	snap.SerialNumber = cert.SerialNumber.String()
	snap.NotBefore = cert.NotBefore.UTC()
	snap.NotAfter = cert.NotAfter.UTC()
	snap.SAN = cert.DNSNames
	snap.TLSVersion = tlsVersionNames[state.Version]
	snap.CipherSuite = tls.CipherSuiteName(state.CipherSuite)

	return snap, nil
}

// sameTLS compares on serial number (a new serial = a renewed/reissued cert)
// plus the negotiated TLS version and cipher, so a protocol downgrade/upgrade
// also shows up as a new timeline entry even between renewals.
func sameTLS(a, b storage.TLSSnapshot) bool {
	return a.SerialNumber == b.SerialNumber && a.TLSVersion == b.TLSVersion && a.CipherSuite == b.CipherSuite
}

// RunTLSCollector periodically inspects each tracked domain's certificate,
// storing a new snapshot only when something changed.
func RunTLSCollector(store *storage.Storage, interval time.Duration) {
	tick := func() {
		domains, err := store.ListDomains()
		if err != nil {
			log.Printf("tls collector: list domains: %v", err)
			return
		}
		for _, d := range domains {
			snap, err := CollectTLS(d.Name)
			if err != nil {
				log.Printf("tls collector: collect for %s: %v", d.Name, err)
				continue
			}
			last, err := store.LatestTLSSnapshot(d.ID)
			if err != nil {
				log.Printf("tls collector: latest snapshot for %s: %v", d.Name, err)
				continue
			}
			if last != nil && sameTLS(*last, snap) {
				continue
			}
			if err := store.InsertTLSSnapshot(d.ID, snap); err != nil {
				log.Printf("tls collector: insert snapshot for %s: %v", d.Name, err)
				continue
			}
			log.Printf("tls collector: new snapshot recorded for %s (expires %s)", d.Name, snap.NotAfter.Format("2006-01-02"))
		}
	}

	tick()
	ticker := time.NewTicker(interval)
	for range ticker.C {
		tick()
	}
}
