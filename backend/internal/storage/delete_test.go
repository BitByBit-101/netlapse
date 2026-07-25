package storage

import (
	"path/filepath"
	"testing"
	"time"
)

// openTestDB gives each test its own on-disk database. A file rather than
// ":memory:" because New() sets MaxOpenConns(1) and the collectors' behaviour we
// care about here is ordinary file-backed usage.
func openTestDB(t *testing.T) *Storage {
	t.Helper()
	s, err := New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// seedAllTables writes one row into every domain-scoped table so a delete that
// misses a table shows up as a leftover row.
func seedAllTables(t *testing.T, s *Storage, id int64, name string) {
	t.Helper()
	now := time.Now().UTC()

	if err := s.InsertDNSSnapshot(id, DNSSnapshot{CapturedAt: now, A: []string{"1.2.3.4"}}); err != nil {
		t.Fatalf("dns: %v", err)
	}
	if err := s.InsertLatencySample(id, LatencySample{CapturedAt: now, LatencyMs: 12, Success: true}); err != nil {
		t.Fatalf("latency: %v", err)
	}
	if err := s.InsertCDNSnapshot(id, CDNSnapshot{CapturedAt: now, Provider: "Cloudflare"}); err != nil {
		t.Fatalf("cdn: %v", err)
	}
	if err := s.InsertASNSnapshot(id, now, []ASNEntry{{IP: "1.2.3.4", ASN: "AS13335"}}); err != nil {
		t.Fatalf("asn: %v", err)
	}
	if err := s.InsertTLSSnapshot(id, TLSSnapshot{CapturedAt: now, Issuer: "test", NotBefore: now, NotAfter: now}); err != nil {
		t.Fatalf("tls: %v", err)
	}
	if err := s.InsertRouteSnapshot(id, RouteSnapshot{CapturedAt: now, Hops: []RouteHop{{Hop: 1}}, Success: true}); err != nil {
		t.Fatalf("route: %v", err)
	}
	if err := s.InsertHealthSnapshot(id, HealthSnapshot{CapturedAt: now, SuccessRate: 1, Status: "healthy"}); err != nil {
		t.Fatalf("health: %v", err)
	}
	if err := s.InsertBGPEvents(id, []BGPEvent{{CapturedAt: now, EventType: "asn_change", IP: "1.2.3.4"}}); err != nil {
		t.Fatalf("bgp: %v", err)
	}
}

// countRows totals the rows keyed to a domain id across every child table.
func countRows(t *testing.T, s *Storage, id int64) map[string]int {
	t.Helper()
	out := map[string]int{}
	for _, table := range childTables {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE domain_id = ?`, id).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		out[table] = n
	}
	return out
}

func TestDeleteDomainRemovesEveryChildRow(t *testing.T) {
	s := openTestDB(t)

	id, err := s.GetOrCreateDomain("example.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	seedAllTables(t, s, id, "example.com")

	// Guard the guard: if seeding silently wrote nothing, the delete assertions
	// below would pass for the wrong reason.
	for table, n := range countRows(t, s, id) {
		if n == 0 {
			t.Fatalf("seed wrote no rows to %s, test would be vacuous", table)
		}
	}

	existed, err := s.DeleteDomain("example.com")
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !existed {
		t.Fatal("DeleteDomain reported the domain did not exist")
	}

	for table, n := range countRows(t, s, id) {
		if n != 0 {
			t.Errorf("%s still has %d row(s) after delete", table, n)
		}
	}

	domains, err := s.ListDomains()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(domains) != 0 {
		t.Errorf("expected no domains, got %v", domains)
	}
}

func TestDeleteDomainLeavesOtherDomainsAlone(t *testing.T) {
	s := openTestDB(t)

	keepID, err := s.GetOrCreateDomain("keep.com")
	if err != nil {
		t.Fatalf("create keep: %v", err)
	}
	dropID, err := s.GetOrCreateDomain("drop.com")
	if err != nil {
		t.Fatalf("create drop: %v", err)
	}
	seedAllTables(t, s, keepID, "keep.com")
	seedAllTables(t, s, dropID, "drop.com")

	if _, err := s.DeleteDomain("drop.com"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	for table, n := range countRows(t, s, keepID) {
		if n == 0 {
			t.Errorf("%s lost keep.com's rows", table)
		}
	}

	domains, err := s.ListDomains()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(domains) != 1 || domains[0].Name != "keep.com" {
		t.Errorf("expected only keep.com to remain, got %v", domains)
	}
}

func TestDeleteDomainUnknownName(t *testing.T) {
	s := openTestDB(t)

	existed, err := s.DeleteDomain("never-tracked.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if existed {
		t.Error("reported an untracked domain as existing")
	}
}

// A re-added domain must start empty. sqlite can reuse a freed AUTOINCREMENT id
// in some situations, so leftover child rows would surface as another domain's
// history.
func TestReAddedDomainHasNoHistory(t *testing.T) {
	s := openTestDB(t)

	id, err := s.GetOrCreateDomain("recycle.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	seedAllTables(t, s, id, "recycle.com")
	if _, err := s.DeleteDomain("recycle.com"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	newID, err := s.GetOrCreateDomain("recycle.com")
	if err != nil {
		t.Fatalf("re-create: %v", err)
	}

	snaps, err := s.ListDNSSnapshots(newID)
	if err != nil {
		t.Fatalf("list dns: %v", err)
	}
	if len(snaps) != 0 {
		t.Errorf("re-added domain inherited %d DNS snapshot(s)", len(snaps))
	}
	for table, n := range countRows(t, s, newID) {
		if n != 0 {
			t.Errorf("re-added domain inherited %d row(s) in %s", n, table)
		}
	}
}
