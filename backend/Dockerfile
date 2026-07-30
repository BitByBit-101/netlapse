# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM golang:1.22-alpine AS build
WORKDIR /src

# Copied first so the dependency layer is cached until go.mod/go.sum change.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 is safe here: the SQLite driver is modernc.org/sqlite, which is
# pure Go. That is what lets the runtime stage stay this small.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
      -o /out/netlapse-server ./cmd/server

# ---- runtime --------------------------------------------------------------
FROM alpine:3.20

# traceroute: the route collector shells out to it (collector/route.go), so
#   without this package every route capture stores an error instead of hops.
# ca-certificates: the CDN collector makes HTTPS requests; scratch/alpine has
#   no root store by default and every TLS dial would fail x509 verification.
# tzdata: timestamps are stored UTC, but this keeps local-time rendering sane
#   if TZ is ever set.
RUN apk add --no-cache traceroute ca-certificates tzdata

# Unprivileged user. The collectors need no root: latency uses a TCP handshake
# rather than ICMP ping, precisely so no raw-socket capability is required.
RUN adduser -D -u 10001 netlapse

# The database lives here so a single volume mount preserves all history.
RUN mkdir -p /data && chown netlapse:netlapse /data

COPY --from=build /out/netlapse-server /usr/local/bin/netlapse-server

USER netlapse
WORKDIR /data
VOLUME ["/data"]

ENV NC_DB_PATH=/data/netlapse.db \
    NC_ADDR=:8080

EXPOSE 8080

# No shell form, so the binary is PID 1 and receives SIGTERM directly.
ENTRYPOINT ["/usr/local/bin/netlapse-server"]
