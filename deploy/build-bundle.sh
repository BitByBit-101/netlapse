#!/usr/bin/env bash
#
# Build a deployment bundle for a Linux host, from any machine with Go and Node.
#
#   ./deploy/build-bundle.sh                 # amd64 (t3/t2 instances)
#   ARCH=arm64 ./deploy/build-bundle.sh      # arm64 (t4g instances)
#
# Produces deploy/netlapse-bundle.tar.gz containing a prebuilt binary and the
# built frontend, so the target server needs NO toolchain: no Go, no Node, and
# no swap file to survive a frontend build on a 1 GB instance.
#
# Upload and run:
#   scp -i key.pem deploy/netlapse-bundle.tar.gz ubuntu@HOST:~
#   ssh -i key.pem ubuntu@HOST 'tar xzf netlapse-bundle.tar.gz && sudo bash netlapse-bundle/provision.sh'
#
# Invoked as `sudo bash ...` rather than `sudo ./...` on purpose: a bundle built
# on Windows cannot carry an exec bit, so the script may extract non-executable.
# Passing it to bash sidesteps that entirely.

set -euo pipefail

ARCH="${ARCH:-amd64}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deploy/netlapse-bundle"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

command -v go   >/dev/null || { echo "go not found"; exit 1; }
command -v npm  >/dev/null || { echo "npm not found"; exit 1; }

say "Building API for linux/$ARCH"
cd "$ROOT/backend"
CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" \
  go build -trimpath -ldflags="-s -w" -o "$OUT.tmp-server" ./cmd/server

say "Building frontend (same-origin)"
cd "$ROOT/frontend"
[[ -d node_modules ]] || npm ci
# Empty VITE_API_URL => the bundle requests relative /api/... paths, which the
# nginx config proxies. Anything else hard-codes a host into the JavaScript.
VITE_API_URL="" npm run build

say "Assembling bundle"
rm -rf "$OUT"
mkdir -p "$OUT"
mv "$OUT.tmp-server" "$OUT/netlapse-server"
chmod +x "$OUT/netlapse-server"
cp -r "$ROOT/frontend/dist" "$OUT/dist"
# setup-domain.sh ships too: provision.sh points at it for the HTTPS step, so
# it has to be present on the server rather than only in the repo.
cp "$ROOT/deploy/nginx-host.conf" "$ROOT/deploy/netlapse.service" \
   "$ROOT/deploy/provision.sh" "$ROOT/deploy/setup-domain.sh" "$OUT/"
chmod +x "$OUT/provision.sh" "$OUT/setup-domain.sh"

cd "$ROOT/deploy"
# Force the exec bits into the archive. On Windows the filesystem has no such
# concept, so without this the bundle extracts on Linux with a non-executable
# binary and provision.sh. Doing it per-file (rather than via tar --mode) is
# what actually sticks, since tar records the mode it finds on disk.
chmod 0755 netlapse-bundle/netlapse-server netlapse-bundle/provision.sh netlapse-bundle/setup-domain.sh
tar czf netlapse-bundle.tar.gz --owner=0 --group=0 netlapse-bundle
rm -rf "$OUT"

# Confirm, rather than assume — a silently non-executable binary is the kind of
# thing that only shows up mid-deploy.
if ! tar tvzf netlapse-bundle.tar.gz | grep -qE '^-rwxr-xr-x.*netlapse-server$'; then
  echo "WARNING: netlapse-server is not executable in the archive." >&2
  echo "provision.sh installs it with mode 0755 anyway, so the deploy still works." >&2
fi

say "Done"
ls -lh "$ROOT/deploy/netlapse-bundle.tar.gz"
