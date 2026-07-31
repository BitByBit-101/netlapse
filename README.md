<div align="center">

# 🕰️ netlapse

### the internet time machine

**The internet forgets. This doesn't.**

netlapse quietly watches a domain — its DNS, latency, CDN, IP ownership, TLS
certificates and network path — and keeps **every change as history you can
scroll back through**. No account, no API keys, no cloud. Just one SQLite file
on your own machine.

<br/>

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://go.dev)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.1-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![SQLite](https://img.shields.io/badge/SQLite-pure_Go-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://modernc.org/sqlite)

[**Why**](#-why) · [**Gallery**](#-gallery) · [**Quick start**](#-quick-start) · [**What it records**](#-what-it-records) · [**16 views**](#-sixteen-views-over-that-history) · [**Deploy**](#-deploy) · [**API**](#-api)

</div>

---

## 💡 Why

Every monitoring tool on earth will tell you whether a site is **up right now**.
Almost none will tell you **what it looked like last Tuesday**.

So when your CDN silently swaps providers, or a certificate quietly renews, or
Google rotates the IP you'd hard-coded into a config file somewhere — there's no
record. The evidence is already gone. You're left squinting at a graph that only
knows about *now*.

netlapse is the boring, useful opposite. It writes down what it sees, forever:

```diff
  2026-07-31 04:32   DNS    A  142.251.42.110
+ 2026-07-31 04:42   DNS    A  142.250.207.14      ← rotation, caught automatically
+ 2026-07-31 04:52   BGP    origin withdrawn       ← AS15169 stopped announcing
+ 2026-07-31 16:15   TLS    serial changed         ← certificate renewed
```

Leave it running for a week, then scrub back through the whole thing like a
video. That's the entire pitch. 🎬

---

## 📸 Gallery

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/01.png" alt="Latency over time" /></td>
    <td width="33%"><img src="docs/screenshots/02.png" alt="DNS change timeline" /></td>
    <td width="33%"><img src="docs/screenshots/03.png" alt="Cross-signal timeline" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/04.png" alt="The netlapse landing page" /></td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/05.png" alt="IP ownership history" /></td>
    <td width="33%"><img src="docs/screenshots/06.png" alt="3D traceroute" /></td>
    <td width="33%"><img src="docs/screenshots/07.png" alt="Availability heatmap" /></td>
  </tr>
</table>

---

## 🚀 Quick start

You need **Go 1.22+** and **Node 20.19+ or 22.12+** (Vite 8 won't install on
Node 18).

```bash
# 1. the API — starts collecting the moment you add a domain
cd backend && go run ./cmd/server        # → :8080

# 2. the dashboard, in a second terminal
cd frontend && npm install && npm run dev # → :5173
```

Open **http://localhost:5173**, type a domain into the sidebar, hit **+**. Every
collector fires a first snapshot immediately, so nothing starts empty. Then walk
away and let it build history. ⏳

> **Tip:** the interesting views need *change* to show off. Leave it running
> overnight and `google.com` will have rotated its A records a dozen times.

Prefer containers? `docker compose up --build` → **http://localhost:8080**.

---

## 📡 What it records

Seven collectors on independent tickers. Four of them **only write when
something actually changed** — git-style history instead of a row a minute.

| | Collector | What it captures | Every | Writes |
|:--|:--|:--|:--|:--|
| 🌐 | **DNS** | A · AAAA · CNAME · NS · MX · TXT | `10m` | on change |
| 🛡️ | **CDN** | Edge provider across 13 candidates, via CNAME → headers → owning ASN | `15m` | on change |
| 🏢 | **ASN** | Who owns each resolved IP (Team Cymru DNS whois, no key) | `30m` | on change |
| 🔒 | **TLS** | Issuer, subject, serial, SANs, validity, cipher | `30m` | on renewal |
| ⚡ | **Latency** | TCP handshake to `:443` — no root, no raw sockets | `30s` | every tick |
| ❤️ | **Health** | healthy / degraded / outage over a 15-minute window | `2m` | every tick |
| 🗺️ | **Route** | Traceroute hops, annotated with owning network | `6h` | every tick |

**BGP** events (`origin_announced` · `origin_changed` · `origin_withdrawn` ·
`prefix_changed`) are derived from the ASN observations rather than collected
separately — no BGP feed subscription required.

---

## 🔭 Sixteen views over that history

<table>
<tr><td>

**📈 Latency** — 1h / 24h / 7d
**🌐 DNS** — change-only record timeline
**🛡️ CDN** — provider swaps
**🏢 ASN** — ownership shifts
**🔒 TLS** — every reissue
**🗺️ Route** — hop-by-hop, per-hop loss

</td><td>

**🌦️ Weather** — 7-day availability heatmap
**📡 BGP** — origin & prefix changes
**🔍 Investigate** — evidence-linked findings
**📰 Events** — one merged feed
**⏮️ Replay** — scrub or auto-play at 0.5–4×
**📊 Predict** — least-squares latency forecast

</td><td>

**🔗 Similar** — domains sharing infrastructure
**🗓️ Timeline** — chronological, filterable
**🔀 Diff** — any two instants, field by field
**🧊 Twin** — the route in 3D
**🐍 …and a snake game** on the landing page

</td></tr>
</table>

A few that are more than they sound:

- **Replay** anchors position on event *id*, so the 15-second poll never yanks
  you out of place mid-scrub. Arrow keys, Home/End, the lot. ⌨️
- **Diff** resolves each stream *as of* the chosen instant, so a slow-ticking
  collector isn't misread as having changed.
- **Predict** reports r², a prediction interval that widens with horizon, and a
  `trend_meaningful` flag when the data simply can't support a trend. It would
  rather say "I don't know" than draw you a confident wrong line. 🤷
- **Investigate** runs entirely locally. Set `NC_LLM_ENABLED=true` and it will
  add a 2–4 sentence narrative via any OpenAI-compatible endpoint (Ollama by
  default) — sending only the domain name and the findings, never your database.
  If the model is down the report still works.
- **Twin** collapses consecutive same-network hops into labelled lanes: X is
  hop position, Y is latency, Z is the operating network.

---

## 🚢 Deploy

| | Path | Good for |
|:--|:--|:--|
| 💻 | `go run` + `npm run dev` | hacking on it |
| 🐳 | `docker compose up --build` | one origin, nginx proxies `/api/`, history in a named volume |
| 🔧 | nginx + systemd on a host | API on loopback, nginx public |
| ☁️ | `deploy/build-bundle.sh` → EC2 | prebuilt bundle + idempotent `provision.sh` |

```bash
./deploy/build-bundle.sh
scp -i key.pem deploy/netlapse-bundle.tar.gz ubuntu@HOST:~
ssh -i key.pem ubuntu@HOST \
  'tar xzf netlapse-bundle.tar.gz && sudo bash netlapse-bundle/provision.sh'
```

`provision.sh` is **idempotent**, never touches the database, and leaves a
certbot-managed nginx config alone — so it's the upgrade path too.

**HTTPS in one command:** `sudo bash setup-domain.sh your-domain.com you@example.com`
checks DNS actually points at the box *before* spending a Let's Encrypt attempt
(`--staging` to rehearse).

**Close port 22 entirely:** `./deploy/setup-ssm.sh` swaps inbound SSH for AWS
Session Manager — dry-run by default, and it refuses to close 22 until SSM
reports the instance `Online`. It can also release idle Elastic IPs you're
quietly being billed for. 💸

---

## ⚙️ Configuration

All optional. Defaults are sane.

```bash
NC_DB_PATH=netlapse.db     # where history lives
NC_ADDR=:8080              # bind address
NC_DNS_INTERVAL=10m        # …and _LATENCY_ 30s, _CDN_ 15m, _ASN_ 30m,
                           #    _TLS_ 30m, _ROUTE_ 6h, _HEALTH_ 2m
NC_LLM_ENABLED=false       # optional narrative; _URL, _MODEL, _API_KEY
```

**Frontend:** `VITE_API_URL` is inlined at **build** time. Leave it empty for
relative `/api/…` paths behind a reverse proxy; unset it and the bundle talks to
`http://localhost:8080`.

---

## 🔌 API

Everything is JSON. Errors are `{"error": "..."}`. No auth — bind to loopback
and let nginx be the front door.

```bash
curl localhost:8080/api/domains
curl -X POST localhost:8080/api/domains -d '{"domain":"github.com"}'
curl -X DELETE localhost:8080/api/domains/github.com
```

| Route | Returns |
|:--|:--|
| `GET /api/domains` | tracked domains |
| `POST /api/domains` | add one; first snapshot fires immediately |
| `DELETE /api/domains/{d}` | erase it and all history, one transaction |
| `GET /api/history/dns\|cdn\|asn\|tls\|route/{d}` | full history, oldest first |
| `GET /api/history/latency/{d}?since_hours=24` | samples in a window |
| `GET /api/history/health/{d}?since_hours=168` | availability snapshots |
| `GET /api/history/bgp/{d}` | origin/prefix events, **newest** first |
| `GET /api/events/{d}?since_hours=168` | merged feed, **newest** first |
| `GET /api/investigate/{d}` | findings (+ narrative if enabled) |
| `GET /api/predict/{d}` | forecast with r² and confidence |
| `GET /api/similar/{d}` | domains ranked by shared infrastructure |

---

## 🧰 Built with

**Backend** — Go 1.22, stdlib `net/http`, and
[`modernc.org/sqlite`](https://modernc.org/sqlite): pure Go, so `CGO_ENABLED=0`
gives a single static binary with no libc to match. Each collector is a
goroutine on its own ticker.

**Frontend** — React 18 + TypeScript (`strict`), Vite 8, Tailwind, Recharts,
three.js. Hash routing with **zero router dependency**, so any static host
serves it with no rewrite rules. The two heavy views — the chart and the 3D twin
— are lazy-loaded, keeping the entry chunk at **253 kB** (75 kB gzipped)
instead of dragging all 1.2 MB in on first paint.

```
backend/internal/{api,storage,collector,events,investigator,predictor,similarity,llm}
frontend/src/{App,Landing}.tsx + components/
deploy/{build-bundle,provision,setup-domain,setup-ssm}.sh
```

---

## 🗺️ Roadmap

Alert rules · CSV / JSON export · WHOIS & registrar history · per-domain
retention policies · multi-region collection.

<div align="center">
<br/>

**Built to answer one question: _what did the internet look like yesterday?_** ✨

</div>
