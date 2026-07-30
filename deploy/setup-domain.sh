#!/usr/bin/env bash
#
# Point netlapse at a domain name and switch it to HTTPS.
#
# Works with any domain whose DNS A record already points at this server,
# including a free DuckDNS subdomain (yourname.duckdns.org).
#
# Usage, on the server:
#   sudo bash setup-domain.sh netlapse.duckdns.org you@example.com
#
# The email is only used by Let's Encrypt to warn you if a renewal ever fails.
# Pass --staging as a third argument to rehearse against Let's Encrypt's test
# CA, which has far looser rate limits (see the RATE LIMIT note below).
#
# Safe to re-run: nginx's server_name is rewritten idempotently and certbot
# reuses an existing certificate rather than issuing a duplicate.

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
STAGING="${3:-}"
SITE=/etc/nginx/sites-available/netlapse

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$1"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -n "$DOMAIN" ]] || die "usage: sudo bash setup-domain.sh <domain> <email> [--staging]"
[[ -n "$EMAIL"  ]] || die "usage: sudo bash setup-domain.sh <domain> <email> [--staging]"
[[ -f "$SITE"   ]] || die "$SITE not found — run provision.sh first"

command -v certbot >/dev/null || die "certbot is not installed: apt install -y certbot python3-certbot-nginx"

# ---------------------------------------------------------------- sanity checks
# Certbot proves domain ownership by fetching a file over port 80 from the IP
# the domain resolves to. If DNS hasn't propagated, or 443 is closed in the
# security group, it fails AFTER burning a rate-limit attempt — so check first.

say "Checking DNS"
SERVER_IP="$(curl -fsS --max-time 5 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
if [[ -z "$SERVER_IP" ]]; then
  TOKEN="$(curl -fsS -X PUT --max-time 5 http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
  SERVER_IP="$(curl -fsS --max-time 5 -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
fi
[[ -n "$SERVER_IP" ]] || die "could not determine this server's public IP"

RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | head -1 || true)"
echo "  $DOMAIN resolves to : ${RESOLVED:-<nothing>}"
echo "  this server is      : $SERVER_IP"

if [[ -z "$RESOLVED" ]]; then
  die "$DOMAIN does not resolve yet. Create the DNS A record, wait a minute, and re-run."
fi
if [[ "$RESOLVED" != "$SERVER_IP" ]]; then
  die "$DOMAIN points at $RESOLVED, not this server ($SERVER_IP). Fix the A record and re-run."
fi

say "Checking that port 443 is reachable from the internet"
# Bound to 0.0.0.0 by nginx only AFTER certbot runs, so testing the listener is
# not meaningful yet. What matters is the security group, which we cannot query
# from inside the instance without credentials -- so warn rather than fail.
warn "  Make sure the EC2 security group allows inbound TCP 443 from 0.0.0.0/0."
warn "  Without it the site will be unreachable over HTTPS after this script."

# ------------------------------------------------------------------ nginx name
say "Setting server_name to $DOMAIN"
# Replace whatever the current server_name is (\_ on a fresh provision) with the
# real domain. Anchored to the directive so nothing else in the file is touched.
sed -i -E "s/^([[:space:]]*)server_name[[:space:]]+.*;/\1server_name $DOMAIN;/" "$SITE"
grep -n "server_name" "$SITE"
nginx -t || die "nginx config test failed"
systemctl reload nginx

# ------------------------------------------------------------------- the cert
say "Requesting a certificate from Let's Encrypt"
# RATE LIMIT: 5 duplicate-certificate issuances per exact domain set per week.
# --keep-until-expiring makes a re-run a no-op while the cert is still valid,
# so this script stays safely idempotent.
CERTBOT_ARGS=(
  --nginx
  -d "$DOMAIN"
  --non-interactive
  --agree-tos
  -m "$EMAIL"
  --redirect            # send all plain HTTP to HTTPS
  --keep-until-expiring
)
[[ "$STAGING" == "--staging" ]] && CERTBOT_ARGS+=(--staging) && \
  warn "  STAGING mode: the cert will NOT be trusted by browsers. Rehearsal only."

certbot "${CERTBOT_ARGS[@]}"

# ------------------------------------------------------------------- verify
say "Verifying"
systemctl reload nginx

echo -n "  HTTPS  "
curl -fsS --max-time 10 -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/" \
  ${STAGING:+--insecure} || die "https://$DOMAIN/ did not respond"

echo -n "  API    "
curl -fsS --max-time 10 -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/api/domains" \
  ${STAGING:+--insecure} || die "the API is not reachable over HTTPS"

echo -n "  HTTP redirects to HTTPS  "
curl -s --max-time 10 -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "http://$DOMAIN/"

say "Checking automatic renewal"
certbot renew --dry-run 2>&1 | tail -3 || warn "  dry-run reported a problem; check 'certbot renew --dry-run'"

cat <<EOF

$(printf '\033[1;32m')netlapse is live at https://$DOMAIN/$(printf '\033[0m')

  Certificate  /etc/letsencrypt/live/$DOMAIN/
  Renewal      automatic, via the certbot systemd timer
  Check        systemctl list-timers | grep certbot

EOF
