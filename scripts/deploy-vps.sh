#!/usr/bin/env bash
# Deploy the web client, authoritative game server, and Redis to one VPS.
# Required: HSC_VPS_HOST, HSC_DOMAIN, HSC_ACME_EMAIL
# Default proxy mode reuses a system Caddy already listening on ports 80/443.

set -euo pipefail

: "${HSC_VPS_HOST:?Set HSC_VPS_HOST to the VPS hostname or IP address}"
: "${HSC_DOMAIN:?Set HSC_DOMAIN to the public DNS name, without https://}"
: "${HSC_ACME_EMAIL:?Set HSC_ACME_EMAIL to the certificate-notice address}"

HSC_VPS_PORT="${HSC_VPS_PORT:-2222}"
HSC_VPS_USER="${HSC_VPS_USER:-root}"
HSC_REMOTE_DIR="${HSC_REMOTE_DIR:-/root/hide-and-seek-cards}"
HSC_PROXY_MODE="${HSC_PROXY_MODE:-host-caddy}"
HSC_ARTIFACT_ONLY="${HSC_ARTIFACT_ONLY:-0}"
HSC_REMOTE="${HSC_VPS_USER}@${HSC_VPS_HOST}"
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p "$HSC_VPS_PORT")

if [[ ! "$HSC_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || [[ "$HSC_DOMAIN" == *..* ]]; then
  echo "HSC_DOMAIN must be a DNS name only, without a protocol, path, or port." >&2
  exit 1
fi

if [[ "$HSC_ACME_EMAIL" != *"@"* ]]; then
  echo "HSC_ACME_EMAIL must be a valid contact email address." >&2
  exit 1
fi

if [[ "$HSC_PROXY_MODE" != "host-caddy" ]]; then
  echo "Only HSC_PROXY_MODE=host-caddy is supported by this helper." >&2
  exit 1
fi

if [[ "$HSC_ARTIFACT_ONLY" != "0" && "$HSC_ARTIFACT_ONLY" != "1" ]]; then
  echo "HSC_ARTIFACT_ONLY must be 0 or 1." >&2
  exit 1
fi

echo "Preparing ${HSC_DOMAIN} on ${HSC_REMOTE}:${HSC_REMOTE_DIR}"
"${SSH[@]}" "$HSC_REMOTE" "mkdir -p '$HSC_REMOTE_DIR'"

rsync -az --delete \
  -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p $HSC_VPS_PORT" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=android \
  --exclude=ios \
  --exclude=coverage \
  --exclude=.env \
  --exclude=.DS_Store \
  ./ "$HSC_REMOTE:$HSC_REMOTE_DIR/"

"${SSH[@]}" "$HSC_REMOTE" \
  "HSC_REMOTE_DIR='$HSC_REMOTE_DIR' HSC_DOMAIN='$HSC_DOMAIN' HSC_ACME_EMAIL='$HSC_ACME_EMAIL' HSC_ARTIFACT_ONLY='$HSC_ARTIFACT_ONLY' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HSC_REMOTE_DIR"

if [[ ! -f .env ]]; then
  umask 077
  session_secret="$(openssl rand -hex 64)"
  redis_password="$(openssl rand -hex 32)"
  printf '%s\n' \
    "APP_DOMAIN=$HSC_DOMAIN" \
    "ACME_EMAIL=$HSC_ACME_EMAIL" \
    "SESSION_SIGNING_SECRET=$session_secret" \
    "REDIS_PASSWORD=$redis_password" \
    "ALLOWED_ORIGINS=https://$HSC_DOMAIN,capacitor://localhost,https://localhost,http://localhost" \
    "VITE_GAME_SERVER_URL=" > .env
  echo "Created a protected production .env with new server secrets."
else
  current_domain="$(sed -n 's/^APP_DOMAIN=//p' .env | head -n 1)"
  if [[ "$current_domain" != "$HSC_DOMAIN" ]]; then
    echo "Refusing deployment: existing .env targets '$current_domain', not '$HSC_DOMAIN'." >&2
    exit 1
  fi
fi

compose=(docker compose -f docker-compose.yml -f docker-compose.host-caddy.yml)
"${compose[@]}" config --quiet
if [[ "$HSC_ARTIFACT_ONLY" == "1" ]]; then
  docker image inspect hide-and-seek-cards-app:latest >/dev/null
  docker tag hide-and-seek-cards-app:latest hide-and-seek-cards-runtime-base:local
  docker build -f Dockerfile.runtime-update -t hide-and-seek-cards-app:latest .
  "${compose[@]}" up -d --no-build --remove-orphans
else
  "${compose[@]}" up -d --build --remove-orphans
fi

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:8787/readyz >/dev/null; then
    break
  fi

  if [[ "$attempt" == "30" ]]; then
    echo "The app container did not become ready in time." >&2
    "${compose[@]}" logs --tail=100 app >&2
    exit 1
  fi

  sleep 1
done

install -d -m 0755 /etc/caddy/Caddyfile.d
cat > /etc/caddy/Caddyfile.d/hide-and-seek-cards.caddy <<CADDY
$HSC_DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
CADDY
if ! grep -Fqx 'import /etc/caddy/Caddyfile.d/*.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/Caddyfile.d/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
"${compose[@]}" ps
REMOTE

echo "Waiting for the live ready check..."
if curl --fail --silent --show-error --retry 12 --retry-connrefused --retry-delay 2 "https://$HSC_DOMAIN/readyz"; then
  echo
  echo "Deployment complete: https://$HSC_DOMAIN"
else
  echo "The service is running, but public DNS/TLS is still propagating for $HSC_DOMAIN." >&2
  echo "Recheck https://$HSC_DOMAIN/readyz after the DNS cache clears." >&2
fi
