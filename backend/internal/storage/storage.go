package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS domains (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT UNIQUE NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dns_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	a_records TEXT,
	aaaa_records TEXT,
	cname TEXT,
	ns_records TEXT,
	mx_records TEXT,
	txt_records TEXT,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_dns_domain_time ON dns_snapshots(domain_id, captured_at);

CREATE TABLE IF NOT EXISTS latency_samples (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	latency_ms REAL,
	success INTEGER,
	error TEXT,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_latency_domain_time ON latency_samples(domain_id, captured_at);

CREATE TABLE IF NOT EXISTS cdn_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	provider TEXT NOT NULL,
	detected_via TEXT,
	evidence TEXT,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_cdn_domain_time ON cdn_snapshots(domain_id, captured_at);

CREATE TABLE IF NOT EXISTS asn_records (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	ip TEXT NOT NULL,
	asn TEXT,
	as_name TEXT,
	country TEXT,
	registry TEXT,
	allocated TEXT,
	prefix TEXT,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_asn_domain_time ON asn_records(domain_id, captured_at);

CREATE TABLE IF NOT EXISTS tls_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	issuer TEXT,
	subject TEXT,
	serial_number TEXT,
	not_before DATETIME,
	not_after DATETIME,
	tls_version TEXT,
	cipher_suite TEXT,
	san_records TEXT,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_tls_domain_time ON tls_snapshots(domain_id, captured_at);

CREATE TABLE IF NOT EXISTS route_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	hops TEXT NOT NULL,
	success INTEGER NOT NULL,
	error TEXT,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_route_domain_time ON route_snapshots(domain_id, captured_at);

CREATE TABLE IF NOT EXISTS health_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	success_rate REAL NOT NULL,
	average_latency_ms REAL,
	status TEXT NOT NULL,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_health_domain_time ON health_snapshots(domain_id, captured_at);

CREATE TABLE IF NOT EXISTS bgp_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	domain_id INTEGER NOT NULL,
	captured_at DATETIME NOT NULL,
	event_type TEXT NOT NULL,
	ip TEXT NOT NULL,
	previous_asn TEXT,
	current_asn TEXT,
	previous_prefix TEXT,
	current_prefix TEXT,
	FOREIGN KEY(domain_id) REFERENCES domains(id)
);
CREATE INDEX IF NOT EXISTS idx_bgp_domain_time ON bgp_events(domain_id, captured_at);
`

// Storage wraps the sqlite database connection.
type Storage struct {
	db *sql.DB
}

// Domain represents a tracked domain.
type Domain struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// DNSSnapshot is a single point-in-time DNS record set.
type DNSSnapshot struct {
	ID          int64     `json:"id"`
	CapturedAt  time.Time `json:"captured_at"`
	A           []string  `json:"a_records"`
	AAAA        []string  `json:"aaaa_records"`
	CNAME       string    `json:"cname"`
	NS          []string  `json:"ns_records"`
	MX          []string  `json:"mx_records"`
	TXT         []string  `json:"txt_records"`
}

// LatencySample is a single latency measurement.
type LatencySample struct {
	ID         int64     `json:"id"`
	CapturedAt time.Time `json:"captured_at"`
	LatencyMs  float64   `json:"latency_ms"`
	Success    bool      `json:"success"`
	Error      string    `json:"error,omitempty"`
}

// CDNSnapshot records which CDN/edge provider a domain appeared to be using.
type CDNSnapshot struct {
	ID          int64     `json:"id"`
	CapturedAt  time.Time `json:"captured_at"`
	Provider    string    `json:"provider"`
	DetectedVia string    `json:"detected_via"`
	Evidence    string    `json:"evidence"`
}

// ASNEntry is the ASN ownership info for a single IP at a point in time.
type ASNEntry struct {
	IP        string `json:"ip"`
	ASN       string `json:"asn"`
	ASName    string `json:"as_name"`
	Country   string `json:"country"`
	Registry  string `json:"registry"`
	Allocated string `json:"allocated"`
	Prefix    string `json:"prefix"`
}

// ASNSnapshot groups every IP's ASN ownership captured together in one pass.
type ASNSnapshot struct {
	CapturedAt time.Time  `json:"captured_at"`
	Entries    []ASNEntry `json:"entries"`
}

// TLSSnapshot records a certificate's identity at a point in time.
type TLSSnapshot struct {
	ID           int64     `json:"id"`
	CapturedAt   time.Time `json:"captured_at"`
	Issuer       string    `json:"issuer"`
	Subject      string    `json:"subject"`
	SerialNumber string    `json:"serial_number"`
	NotBefore    time.Time `json:"not_before"`
	NotAfter     time.Time `json:"not_after"`
	TLSVersion   string    `json:"tls_version"`
	CipherSuite  string    `json:"cipher_suite"`
	SAN          []string  `json:"san_records"`
}

// RouteHop is one network hop observed while tracing a domain.
//
// Hops are persisted as JSON in a single column, so added fields need no schema
// migration; older rows simply decode with the new fields zeroed.
type RouteHop struct {
	Hop       int     `json:"hop"`
	Address   string  `json:"address"`
	LatencyMs float64 `json:"latency_ms"`
	// TimedOut means every probe to this hop was lost. A hop that answered some
	// probes is NOT timed out, even though its line contains a "*".
	TimedOut bool `json:"timed_out"`
	// Probes sent / answered, so partial loss is visible instead of being
	// flattened into a single boolean. A hop losing 2 of 3 probes is a real
	// signal that the old model could not express.
	ProbesSent  int `json:"probes_sent"`
	ProbesLost  int `json:"probes_lost"`
	// MinLatencyMs/MaxLatencyMs expose per-hop jitter; the mean alone hides a
	// hop that alternates between 20 ms and 300 ms.
	MinLatencyMs float64 `json:"min_latency_ms"`
	MaxLatencyMs float64 `json:"max_latency_ms"`
	// ASN/ASName/Country identify who operates this hop. A bare IP address is
	// close to meaningless to a reader; "AS15169 Google" is the thing that makes
	// a traceroute interpretable — it shows where your traffic leaves your ISP
	// and enters the destination's network.
	ASN     string `json:"asn,omitempty"`
	ASName  string `json:"as_name,omitempty"`
	Country string `json:"country,omitempty"`
	// Private marks RFC1918 / link-local / ULA addresses, which have no public
	// owner and must not be sent to Cymru.
	Private bool `json:"private,omitempty"`
}

// RouteSnapshot captures the observed path to a domain at a point in time.
type RouteSnapshot struct {
	ID         int64      `json:"id"`
	CapturedAt time.Time  `json:"captured_at"`
	Hops       []RouteHop `json:"hops"`
	Success    bool       `json:"success"`
	Error      string     `json:"error,omitempty"`
}

// HealthSnapshot summarizes recent connection availability for a domain.
type HealthSnapshot struct {
	ID               int64     `json:"id"`
	CapturedAt       time.Time `json:"captured_at"`
	SuccessRate      float64   `json:"success_rate"`
	AverageLatencyMs float64   `json:"average_latency_ms"`
	Status           string    `json:"status"`
}

// BGPEvent records a detected change in the origin ASN or announced prefix.
type BGPEvent struct {
	ID             int64     `json:"id"`
	CapturedAt     time.Time `json:"captured_at"`
	EventType      string    `json:"event_type"`
	IP             string    `json:"ip"`
	PreviousASN    string    `json:"previous_asn"`
	CurrentASN     string    `json:"current_asn"`
	PreviousPrefix string    `json:"previous_prefix"`
	CurrentPrefix  string    `json:"current_prefix"`
}

// New opens (or creates) the sqlite database at path and ensures the schema exists.
func New(path string) (*Storage, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1) // sqlite: keep writes serialized to avoid "database is locked"
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Storage{db: db}, nil
}

// Close closes the underlying database handle.
func (s *Storage) Close() error {
	return s.db.Close()
}

// GetOrCreateDomain returns the id of the domain, inserting it if it does not exist.
func (s *Storage) GetOrCreateDomain(name string) (int64, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM domains WHERE name = ?`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	res, err := s.db.Exec(`INSERT INTO domains (name) VALUES (?)`, name)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// childTables are every table holding rows keyed by domain_id. Deleting a
// domain has to clear all of them explicitly: the foreign keys are declared
// without ON DELETE CASCADE, and sqlite does not enforce them at all unless
// `PRAGMA foreign_keys = ON` is set per connection. Leaving these behind would
// orphan the rows and let a re-added domain inherit the old history, because
// AUTOINCREMENT could hand out a recycled id.
var childTables = []string{
	"dns_snapshots",
	"latency_samples",
	"cdn_snapshots",
	"asn_records",
	"tls_snapshots",
	"route_snapshots",
	"health_snapshots",
	"bgp_events",
}

// DeleteDomain removes a domain and every record collected for it, reporting
// whether a domain by that name existed.
//
// All deletes run in one transaction so a failure partway through cannot leave
// a domain whose history is half gone.
func (s *Storage) DeleteDomain(name string) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback() //nolint:errcheck // no-op once Commit succeeds

	var id int64
	if err := tx.QueryRow(`SELECT id FROM domains WHERE name = ?`, name).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}

	for _, table := range childTables {
		// The table name is from the fixed list above, never from user input.
		if _, err := tx.Exec(`DELETE FROM `+table+` WHERE domain_id = ?`, id); err != nil {
			return false, fmt.Errorf("delete from %s: %w", table, err)
		}
	}
	if _, err := tx.Exec(`DELETE FROM domains WHERE id = ?`, id); err != nil {
		return false, fmt.Errorf("delete domain: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// ListDomains returns all tracked domains.
func (s *Storage) ListDomains() ([]Domain, error) {
	rows, err := s.db.Query(`SELECT id, name FROM domains ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Domain, 0)
	for rows.Next() {
		var d Domain
		if err := rows.Scan(&d.ID, &d.Name); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func joinJSON(v []string) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func splitJSON(s string) []string {
	if s == "" {
		return nil
	}
	var v []string
	_ = json.Unmarshal([]byte(s), &v)
	return v
}

// LatestDNSSnapshot returns the most recent snapshot for a domain, or nil if none exists.
func (s *Storage) LatestDNSSnapshot(domainID int64) (*DNSSnapshot, error) {
	row := s.db.QueryRow(`
		SELECT id, captured_at, a_records, aaaa_records, cname, ns_records, mx_records, txt_records
		FROM dns_snapshots WHERE domain_id = ? ORDER BY captured_at DESC LIMIT 1`, domainID)

	var snap DNSSnapshot
	var a, aaaa, ns, mx, txt string
	var capturedAt string
	err := row.Scan(&snap.ID, &capturedAt, &a, &aaaa, &snap.CNAME, &ns, &mx, &txt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	snap.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
	snap.A, snap.AAAA, snap.NS, snap.MX, snap.TXT = splitJSON(a), splitJSON(aaaa), splitJSON(ns), splitJSON(mx), splitJSON(txt)
	return &snap, nil
}

// InsertDNSSnapshot stores a new DNS snapshot for a domain.
func (s *Storage) InsertDNSSnapshot(domainID int64, snap DNSSnapshot) error {
	_, err := s.db.Exec(`
		INSERT INTO dns_snapshots (domain_id, captured_at, a_records, aaaa_records, cname, ns_records, mx_records, txt_records)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		domainID, snap.CapturedAt.Format(time.RFC3339),
		joinJSON(snap.A), joinJSON(snap.AAAA), snap.CNAME, joinJSON(snap.NS), joinJSON(snap.MX), joinJSON(snap.TXT))
	return err
}

// ListDNSSnapshots returns all snapshots for a domain, oldest first.
func (s *Storage) ListDNSSnapshots(domainID int64) ([]DNSSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT id, captured_at, a_records, aaaa_records, cname, ns_records, mx_records, txt_records
		FROM dns_snapshots WHERE domain_id = ? ORDER BY captured_at ASC`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []DNSSnapshot
	for rows.Next() {
		var snap DNSSnapshot
		var a, aaaa, ns, mx, txt, capturedAt string
		if err := rows.Scan(&snap.ID, &capturedAt, &a, &aaaa, &snap.CNAME, &ns, &mx, &txt); err != nil {
			return nil, err
		}
		snap.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
		snap.A, snap.AAAA, snap.NS, snap.MX, snap.TXT = splitJSON(a), splitJSON(aaaa), splitJSON(ns), splitJSON(mx), splitJSON(txt)
		out = append(out, snap)
	}
	return out, rows.Err()
}

// InsertLatencySample stores a latency measurement.
func (s *Storage) InsertLatencySample(domainID int64, sample LatencySample) error {
	_, err := s.db.Exec(`
		INSERT INTO latency_samples (domain_id, captured_at, latency_ms, success, error)
		VALUES (?, ?, ?, ?, ?)`,
		domainID, sample.CapturedAt.Format(time.RFC3339), sample.LatencyMs, boolToInt(sample.Success), sample.Error)
	return err
}

// ListLatencySamples returns samples for a domain captured after `since`.
func (s *Storage) ListLatencySamples(domainID int64, since time.Time) ([]LatencySample, error) {
	rows, err := s.db.Query(`
		SELECT id, captured_at, latency_ms, success, error
		FROM latency_samples WHERE domain_id = ? AND captured_at >= ? ORDER BY captured_at ASC`,
		domainID, since.Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LatencySample
	for rows.Next() {
		var sample LatencySample
		var capturedAt string
		var success int
		if err := rows.Scan(&sample.ID, &capturedAt, &sample.LatencyMs, &success, &sample.Error); err != nil {
			return nil, err
		}
		sample.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
		sample.Success = success == 1
		out = append(out, sample)
	}
	return out, rows.Err()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// DomainIDByName looks up a domain's id by name. Returns sql.ErrNoRows if not found.
func (s *Storage) DomainIDByName(name string) (int64, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM domains WHERE name = ?`, name).Scan(&id)
	return id, err
}

// ---- CDN ----

// LatestCDNSnapshot returns the most recent CDN detection for a domain, or nil.
func (s *Storage) LatestCDNSnapshot(domainID int64) (*CDNSnapshot, error) {
	row := s.db.QueryRow(`
		SELECT id, captured_at, provider, detected_via, evidence
		FROM cdn_snapshots WHERE domain_id = ? ORDER BY captured_at DESC LIMIT 1`, domainID)
	var snap CDNSnapshot
	var capturedAt string
	err := row.Scan(&snap.ID, &capturedAt, &snap.Provider, &snap.DetectedVia, &snap.Evidence)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	snap.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
	return &snap, nil
}

// InsertCDNSnapshot stores a new CDN detection result.
func (s *Storage) InsertCDNSnapshot(domainID int64, snap CDNSnapshot) error {
	_, err := s.db.Exec(`
		INSERT INTO cdn_snapshots (domain_id, captured_at, provider, detected_via, evidence)
		VALUES (?, ?, ?, ?, ?)`,
		domainID, snap.CapturedAt.Format(time.RFC3339), snap.Provider, snap.DetectedVia, snap.Evidence)
	return err
}

// ListCDNSnapshots returns all CDN detections for a domain, oldest first.
func (s *Storage) ListCDNSnapshots(domainID int64) ([]CDNSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT id, captured_at, provider, detected_via, evidence
		FROM cdn_snapshots WHERE domain_id = ? ORDER BY captured_at ASC`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CDNSnapshot
	for rows.Next() {
		var snap CDNSnapshot
		var capturedAt string
		if err := rows.Scan(&snap.ID, &capturedAt, &snap.Provider, &snap.DetectedVia, &snap.Evidence); err != nil {
			return nil, err
		}
		snap.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
		out = append(out, snap)
	}
	return out, rows.Err()
}

// ---- ASN ----

// LatestASNSnapshot returns every IP's ASN ownership from the most recent capture pass.
func (s *Storage) LatestASNSnapshot(domainID int64) (*ASNSnapshot, error) {
	var latest string
	err := s.db.QueryRow(`SELECT captured_at FROM asn_records WHERE domain_id = ? ORDER BY captured_at DESC LIMIT 1`, domainID).Scan(&latest)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT ip, asn, as_name, country, registry, allocated, prefix
		FROM asn_records WHERE domain_id = ? AND captured_at = ? ORDER BY ip`, domainID, latest)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	snap := &ASNSnapshot{}
	snap.CapturedAt, _ = time.Parse(time.RFC3339, latest)
	for rows.Next() {
		var e ASNEntry
		if err := rows.Scan(&e.IP, &e.ASN, &e.ASName, &e.Country, &e.Registry, &e.Allocated, &e.Prefix); err != nil {
			return nil, err
		}
		snap.Entries = append(snap.Entries, e)
	}
	return snap, rows.Err()
}

// InsertASNSnapshot stores a full capture pass (one row per IP) sharing one timestamp.
func (s *Storage) InsertASNSnapshot(domainID int64, capturedAt time.Time, entries []ASNEntry) error {
	ts := capturedAt.Format(time.RFC3339)
	for _, e := range entries {
		_, err := s.db.Exec(`
			INSERT INTO asn_records (domain_id, captured_at, ip, asn, as_name, country, registry, allocated, prefix)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			domainID, ts, e.IP, e.ASN, e.ASName, e.Country, e.Registry, e.Allocated, e.Prefix)
		if err != nil {
			return err
		}
	}
	return nil
}

// ListASNSnapshots returns all ASN capture passes for a domain, oldest first, grouped by timestamp.
func (s *Storage) ListASNSnapshots(domainID int64) ([]ASNSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT captured_at, ip, asn, as_name, country, registry, allocated, prefix
		FROM asn_records WHERE domain_id = ? ORDER BY captured_at ASC, ip ASC`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ASNSnapshot
	byTime := map[string]int{} // captured_at -> index in out
	for rows.Next() {
		var capturedAt string
		var e ASNEntry
		if err := rows.Scan(&capturedAt, &e.IP, &e.ASN, &e.ASName, &e.Country, &e.Registry, &e.Allocated, &e.Prefix); err != nil {
			return nil, err
		}
		idx, ok := byTime[capturedAt]
		if !ok {
			t, _ := time.Parse(time.RFC3339, capturedAt)
			out = append(out, ASNSnapshot{CapturedAt: t})
			idx = len(out) - 1
			byTime[capturedAt] = idx
		}
		out[idx].Entries = append(out[idx].Entries, e)
	}
	return out, rows.Err()
}

// ---- TLS ----

// LatestTLSSnapshot returns the most recent certificate snapshot for a domain, or nil.
func (s *Storage) LatestTLSSnapshot(domainID int64) (*TLSSnapshot, error) {
	row := s.db.QueryRow(`
		SELECT id, captured_at, issuer, subject, serial_number, not_before, not_after, tls_version, cipher_suite, san_records
		FROM tls_snapshots WHERE domain_id = ? ORDER BY captured_at DESC LIMIT 1`, domainID)
	return scanTLSRow(row)
}

// InsertTLSSnapshot stores a new certificate snapshot.
func (s *Storage) InsertTLSSnapshot(domainID int64, snap TLSSnapshot) error {
	_, err := s.db.Exec(`
		INSERT INTO tls_snapshots (domain_id, captured_at, issuer, subject, serial_number, not_before, not_after, tls_version, cipher_suite, san_records)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		domainID, snap.CapturedAt.Format(time.RFC3339), snap.Issuer, snap.Subject, snap.SerialNumber,
		snap.NotBefore.Format(time.RFC3339), snap.NotAfter.Format(time.RFC3339),
		snap.TLSVersion, snap.CipherSuite, joinJSON(snap.SAN))
	return err
}

// ListTLSSnapshots returns all certificate snapshots for a domain, oldest first.
func (s *Storage) ListTLSSnapshots(domainID int64) ([]TLSSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT id, captured_at, issuer, subject, serial_number, not_before, not_after, tls_version, cipher_suite, san_records
		FROM tls_snapshots WHERE domain_id = ? ORDER BY captured_at ASC`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TLSSnapshot
	for rows.Next() {
		snap, err := scanTLSRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *snap)
	}
	return out, rows.Err()
}

// scannable abstracts over *sql.Row and *sql.Rows, which share Scan's signature.
type scannable interface {
	Scan(dest ...any) error
}

func scanTLSRow(row scannable) (*TLSSnapshot, error) {
	var snap TLSSnapshot
	var capturedAt, notBefore, notAfter, san string
	err := row.Scan(&snap.ID, &capturedAt, &snap.Issuer, &snap.Subject, &snap.SerialNumber,
		&notBefore, &notAfter, &snap.TLSVersion, &snap.CipherSuite, &san)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	snap.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
	snap.NotBefore, _ = time.Parse(time.RFC3339, notBefore)
	snap.NotAfter, _ = time.Parse(time.RFC3339, notAfter)
	snap.SAN = splitJSON(san)
	return &snap, nil
}

// InsertRouteSnapshot stores one traceroute capture.
func (s *Storage) InsertRouteSnapshot(domainID int64, snap RouteSnapshot) error {
	hops, err := json.Marshal(snap.Hops)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
		INSERT INTO route_snapshots (domain_id, captured_at, hops, success, error)
		VALUES (?, ?, ?, ?, ?)`,
		domainID, snap.CapturedAt.Format(time.RFC3339), string(hops), boolToInt(snap.Success), snap.Error)
	return err
}

// ListRouteSnapshots returns route captures for a domain, oldest first.
func (s *Storage) ListRouteSnapshots(domainID int64) ([]RouteSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT id, captured_at, hops, success, error
		FROM route_snapshots WHERE domain_id = ? ORDER BY captured_at ASC`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]RouteSnapshot, 0)
	for rows.Next() {
		var snap RouteSnapshot
		var capturedAt, hops string
		var success int
		if err := rows.Scan(&snap.ID, &capturedAt, &hops, &success, &snap.Error); err != nil {
			return nil, err
		}
		snap.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
		snap.Success = success == 1
		if err := json.Unmarshal([]byte(hops), &snap.Hops); err != nil {
			return nil, err
		}
		out = append(out, snap)
	}
	return out, rows.Err()
}

// InsertHealthSnapshot stores a calculated availability status.
func (s *Storage) InsertHealthSnapshot(domainID int64, snap HealthSnapshot) error {
	_, err := s.db.Exec(`
		INSERT INTO health_snapshots (domain_id, captured_at, success_rate, average_latency_ms, status)
		VALUES (?, ?, ?, ?, ?)`,
		domainID, snap.CapturedAt.Format(time.RFC3339), snap.SuccessRate, snap.AverageLatencyMs, snap.Status)
	return err
}

// ListHealthSnapshots returns recent availability summaries, oldest first.
func (s *Storage) ListHealthSnapshots(domainID int64, since time.Time) ([]HealthSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT id, captured_at, success_rate, average_latency_ms, status
		FROM health_snapshots WHERE domain_id = ? AND captured_at >= ? ORDER BY captured_at ASC`,
		domainID, since.Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]HealthSnapshot, 0)
	for rows.Next() {
		var snap HealthSnapshot
		var capturedAt string
		if err := rows.Scan(&snap.ID, &capturedAt, &snap.SuccessRate, &snap.AverageLatencyMs, &snap.Status); err != nil {
			return nil, err
		}
		snap.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
		out = append(out, snap)
	}
	return out, rows.Err()
}

// InsertBGPEvents stores origin and prefix changes detected in a capture pass.
func (s *Storage) InsertBGPEvents(domainID int64, events []BGPEvent) error {
	for _, event := range events {
		_, err := s.db.Exec(`
			INSERT INTO bgp_events (domain_id, captured_at, event_type, ip, previous_asn, current_asn, previous_prefix, current_prefix)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			domainID, event.CapturedAt.Format(time.RFC3339), event.EventType, event.IP,
			event.PreviousASN, event.CurrentASN, event.PreviousPrefix, event.CurrentPrefix)
		if err != nil {
			return err
		}
	}
	return nil
}

// ListBGPEvents returns BGP-origin changes for a domain, newest first.
func (s *Storage) ListBGPEvents(domainID int64) ([]BGPEvent, error) {
	rows, err := s.db.Query(`
		SELECT id, captured_at, event_type, ip, previous_asn, current_asn, previous_prefix, current_prefix
		FROM bgp_events WHERE domain_id = ? ORDER BY captured_at DESC`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]BGPEvent, 0)
	for rows.Next() {
		var event BGPEvent
		var capturedAt string
		if err := rows.Scan(&event.ID, &capturedAt, &event.EventType, &event.IP, &event.PreviousASN,
			&event.CurrentASN, &event.PreviousPrefix, &event.CurrentPrefix); err != nil {
			return nil, err
		}
		event.CapturedAt, _ = time.Parse(time.RFC3339, capturedAt)
		out = append(out, event)
	}
	return out, rows.Err()
}
