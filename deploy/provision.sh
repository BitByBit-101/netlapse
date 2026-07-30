#!/usr/bin/env bash
#
# Provision netlapse on a fresh Ubuntu host (EC2, or any VM).
#
# Expects the deployment bundle already unpacked in the same directory:
#   netlapse-server        the API binary (linux/amd64, statically linked)
#   dist/                  the built frontend
#   nginx-host.conf        nginx site config
#   netlapse.service       systemd unit
#
# Usage, from inside the unpacked bundle directory:
#   sudo ./provision.sh
#
# Safe to re-run: every step is idempotent, so this doubles as the upgrade
# path. Re-running never touches the database.

set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_USER=netlapse
APP_DIR=/opt/netlapse
WEB_DIR=/var/www/netlapse
DATA_DIR=/var/lib/netlapse

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

for f in netlapse-server nginx-host.conf netlapse.service; do
  [[ -f "$BUNDLE_DIR/$f" ]] || die "missing $f in $BUNDLE_DIR"
done
[[ -d "$BUNDLE_DIR/dist" ]] || die "missing dist/ in $BUNDLE_DIR"

say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# traceroute is REQUIRED: the route collector shells out to it, and without it
# every route capture records an error instead of hops.
apt-get install -y -qq nginx traceroute ca-certificates

say "Creating service user and directories"
# The unit sets Group=netlapse, so the group must exist even in the unlikely
# case that useradd was configured not to create one per user.
getent group "$APP_USER" >/dev/null || groupadd --system "$APP_USER"
id -u "$APP_USER" &>/dev/null || \
  useradd --system --gid "$APP_USER" --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$WEB_DIR" "$DATA_DIR"

say "Installing API binary"
# Stop before replacing: overwriting a running executable fails with ETXTBSY.
systemctl stop netlapse 2>/dev/null || true
install -m 0755 -o root -g root "$BUNDLE_DIR/netlapse-server" "$APP_DIR/netlapse-server"
chown "$APP_USER:$APP_USER" "$DATA_DIR"

say "Installing frontend"
# ${WEB_DIR:?} rather than "$WEB_DIR": if the variable were ever empty this line
# would expand to `rm -rf /*` and wipe the host. The :? form aborts instead.
rm -rf "${WEB_DIR:?}"/*
cp -r "$BUNDLE_DIR/dist/." "$WEB_DIR/"
# nginx runs as www-data and only needs read access.
chown -R root:root "$WEB_DIR"
find "$WEB_DIR" -type d -exec chmod 755 {} \;
find "$WEB_DIR" -type f -exec chmod 644 {} \;

say "Installing systemd unit"
install -m 0644 "$BUNDLE_DIR/netlapse.service" /etc/systemd/system/netlapse.service
systemctl daemon-reload
systemctl enable netlapse >/dev/null
systemctl start netlapse

say "Configuring nginx"
SITE=/etc/nginx/sites-available/netlapse
# Once certbot has run, the installed config is no longer this file: certbot
# rewrote it in place to add the TLS listener, the certificate paths and the
# port-80 redirect. Overwriting it here would drop the site back to plain HTTP
# on every upgrade, and reload nginx with the redirect gone. Nothing in this
# script needs to change nginx to ship a new binary or new frontend assets, so
# leave a customised config alone.
if [[ -f "$SITE" ]] && grep -q '^[[:space:]]*ssl_certificate' "$SITE"; then
  echo "existing config has TLS configured — keeping it (run certbot/setup-domain.sh to change it)"
else
  install -m 0644 "$BUNDLE_DIR/nginx-host.conf" "$SITE"
fi
ln -sfn "$SITE" /etc/nginx/sites-enabled/netlapse
# The default site also listens on :80 and would win on server_name _.
rm -f /etc/nginx/sites-enabled/default
nginx -t || die "nginx config test failed"
systemctl reload nginx

say "Waiting for the API to come up"
ok=false
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/api/domains >/dev/null 2>&1; then ok=true; break; fi
  sleep 1
done

if [[ "$ok" != true ]]; then
  printf '\n\033[1;31mAPI did not respond on 127.0.0.1:8080\033[0m\n'
  journalctl -u netlapse -n 40 --no-pager || true
  die "see the log above"
fi

say "Verifying through nginx"
# Once certbot has run, server_name is the real domain and it appends a
# `return 404` block for every other Host — so a bare http://127.0.0.1/ request
# is answered 404 by design, and checking it would fail a perfectly good deploy.
# Send the domain as the Host header instead, and follow the redirect to HTTPS
# that certbot installed.
# Strip the trailing semicolon BEFORE comparing: in `server_name _;` the field is
# "_;", so testing it against "_" first would let the catch-all through and send
# a Host of literally "_".
SERVED_NAME="$(awk '/^[[:space:]]*server_name/ { gsub(/;/, "", $2); if ($2 != "_" && $2 != "") { print $2; exit } }' "$SITE")"
if [[ -n "$SERVED_NAME" ]]; then
  verify() { curl -fsS --max-time 8 --resolve "$SERVED_NAME:80:127.0.0.1" \
                  --resolve "$SERVED_NAME:443:127.0.0.1" -L "http://$SERVED_NAME$1"; }
  TARGET="https://$SERVED_NAME"
else
  verify() { curl -fsS --max-time 8 "http://127.0.0.1$1"; }
  TARGET="http://127.0.0.1"
fi
verify /api/domains >/dev/null || die "nginx is not proxying /api/ (checked $TARGET/api/domains)"
verify / >/dev/null || die "nginx is not serving the app (checked $TARGET/)"
echo "verified at $TARGET"

PUBLIC_IP="$(curl -fsS --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
if [[ -z "$PUBLIC_IP" ]]; then
  # An instance configured for IMDSv2 rejects the unauthenticated read above, so
  # retry with a session token. Same fallback as setup-domain.sh.
  TOKEN="$(curl -fsS -X PUT --max-time 3 http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
  PUBLIC_IP="$(curl -fsS --max-time 3 -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
fi

cat <<EOF

$(printf '\033[1;32m')netlapse is live.$(printf '\033[0m')

  URL            $TARGET/
  API            proxied at /api/ (bound to 127.0.0.1:8080, not public)
  Database       $DATA_DIR/netlapse.db
  Service        systemctl status netlapse
  Logs           journalctl -u netlapse -f
EOF

# Only pitch the HTTPS setup at a host that does not already have it. Telling
# someone to run certbot on a site already serving a valid certificate invites
# them to burn one of the five weekly issuances for that domain.
if [[ "$TARGET" == https://* ]]; then
  cat <<EOF

Already serving HTTPS. Renewal is handled by the certbot systemd timer; check it
with \`systemctl list-timers 'certbot*'\`. Re-running this script leaves the TLS
config alone, so it is safe as the upgrade path.

EOF
else
  cat <<EOF

Next:
  1. Open the URL and add a domain to start recording history.
  2. For HTTPS, point a DNS A record at ${PUBLIC_IP:-the public IP of this host}, then:
       sudo apt install -y certbot python3-certbot-nginx
       sudo bash setup-domain.sh your-domain.com you@example.com

EOF
fi
