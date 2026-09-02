# Single-VPS deployment

This runbook deploys the web client, multiplayer server, Caddy, and Redis to one Linux VPS with Docker Compose.

## Assumptions

- The VPS has a supported Linux distribution, Docker Engine, Docker Compose v2, and at least 2 GB RAM.
- A public DNS A record, and an AAAA record only when IPv6 is configured correctly, points the chosen game domain to the VPS.
- The application uses `https://cards.thoughtlesslabs.com` for web, API, and Socket.IO.
- The Compose application publishes only TCP 80, TCP 443, and UDP 443. SSH or a private administration tunnel is managed at the host level and restricted to trusted operators.
- The checked-out Git revision is the release artifact. Production is not built from an uncommitted working tree.

## 1. Prepare the host

Install Docker from its official repository and enable automatic security updates for the host. Create a non-root deployment user with access to Docker.

At the firewall or cloud security-group layer:

- allow TCP 80 from the internet for certificate issuance and HTTPS redirects;
- allow TCP 443 from the internet;
- allow UDP 443 from the internet for HTTP/3, or remove the UDP mapping if HTTP/3 is not wanted;
- do not expose 8787 or 6379;
- restrict SSH to a private network or known operator IPs.

Place the checkout in a stable path, for example `/opt/hide-and-seek-cards`, owned by the deployment user.

## 2. Configure DNS and secrets

Copy the template without editing the tracked example:

```sh
cp .env.example .env
chmod 600 .env
```

Generate independent URL-safe secrets:

```sh
openssl rand -hex 64
openssl rand -hex 32
```

Put the first value in `SESSION_SIGNING_SECRET` and the second in `REDIS_PASSWORD`. Do not paste generated values into tickets, chat, CI logs, screenshots, or Git.

Edit these required fields in `.env`:

- `APP_DOMAIN`: DNS name only, without `https://` or a trailing slash;
- `ACME_EMAIL`: monitored address for certificate notices;
- `SESSION_SIGNING_SECRET`: at least 32 random bytes;
- `REDIS_PASSWORD`: URL-safe random value because it is embedded in `REDIS_URL`;
- `ALLOWED_ORIGINS`: exact comma-separated origins, including the final HTTPS site and the Capacitor local origins.

For the recommended Capacitor configuration, the native origins are `capacitor://localhost` on iOS and `https://localhost` on Android. `http://localhost` may remain for Capacitor compatibility, but never add `*`.

`VITE_GAME_SERVER_URL` is a public build-time value, not a secret. The Docker web build deliberately leaves it blank and uses the same origin. Native builds set it to the public HTTPS game origin.

The default single-process connection ceilings are `MAX_SOCKET_CONNECTIONS=2000` globally and `MAX_SOCKET_CONNECTIONS_PER_USER=4` for one player card. Treat the global value as a load-tested safety ceiling, not a capacity promise; reduce it on a small VPS or increase it only after load and memory testing.

`REDIS_OPERATION_TIMEOUT_MS=2000` bounds each Redis connect, read, and write attempt. A timeout moves persistence into the in-memory fallback instead of blocking every room behind one stalled Redis command. Increase it only when measured Redis latency justifies the longer gameplay stall.

## 3. Validate and start

Pull the exact release revision, then validate Compose. `docker compose config` without `--quiet` expands secrets, so do not save or share that output.

```sh
docker compose config --quiet
docker compose build --pull app
docker compose up -d
docker compose ps
```

Caddy will request and renew TLS certificates automatically. Certificate issuance requires correct public DNS and inbound ports 80/443.

## 4. Smoke-test

Use the production hostname in these commands:

```sh
curl --fail --silent --show-error https://cards.thoughtlesslabs.com/healthz
curl --fail --silent --show-error https://cards.thoughtlesslabs.com/readyz
curl --fail --silent --show-error https://cards.thoughtlesslabs.com/manifest.webmanifest
```

Then verify from two separate networks or devices:

1. Create anonymous player cards.
2. Create a private room, share the code, and join it.
3. Play through a full round, background one client, resume it, and confirm state recovery.
4. Keep both clients open, restart only the application with `docker compose restart app`, and confirm both clients reconnect automatically into the same Redis-backed room without pressing Retry.
5. Confirm `docker compose ps` reports `app` and `redis` healthy and Caddy running.

The repository also includes a two-player restart smoke test. Run it from a trusted operator machine with the release dependencies installed:

```sh
SMOKE_BASE_URL=https://cards.thoughtlesslabs.com \
SMOKE_ORIGIN=https://cards.thoughtlesslabs.com \
pnpm smoke:compose-live
```

When it prints `READY_FOR_APP_RESTART`, run `docker compose restart app`, wait for the replacement container to become healthy, then press Enter in the smoke-test terminal. The test keeps both authenticated WebSockets open, requires each to observe the outage and reconnect automatically, resynchronizes the same Redis-backed room, and prints no session tokens.

Inspect logs without exposing the environment:

```sh
docker compose logs --tail=200 app
docker compose logs --tail=200 caddy
docker compose logs --tail=100 redis
```

The normal ready response is HTTP 200 with `ok: true`, `persistence: "durable"`, and `snapshotStore: "redis"`. Readiness deliberately distinguishes two Redis failure phases:

- On cold start, before the process has loaded authoritative Redis state, `/healthz` and the bundled Solo/web shell remain available, but `/readyz` returns HTTP 503 with `ok: false` and `persistence: "degraded"`. New anonymous sessions and Socket.IO handshakes receive retryable failures during this phase. The process probes Redis at a bounded five-second interval, validates each stored room independently, and rehydrates valid missing rooms when Redis returns; no restart is required.
- After a successful load, a runtime Redis outage or command timeout keeps `/readyz` at HTTP 200 with `ok: true`, `degraded: true`, and `snapshotStore: "memory-fallback"`. Each Redis operation is bounded by `REDIS_OPERATION_TIMEOUT_MS`; the client connection is destroyed after a timeout so recovery retries buffered per-room saves and delete tombstones on a fresh connection. This is an alert condition, not a signal to restart the process or remove it from routing.

Recovery does not report `snapshotStore: "redis"` until every buffered mutation drains. An app or host restart during runtime fallback can still lose those in-memory changes. If Redis returns after a cold-start failure, confirm that `/readyz` becomes durable and that a previously persisted session can resume before declaring the incident resolved.

During a planned app stop, the server first rejects new online actions, waits for in-flight actions and the authoritative tick, flushes rooms, then closes Engine.IO transports without issuing a terminal Socket.IO namespace disconnect. Connected clients therefore enter their normal automatic-reconnection path and resume the durable room on the replacement process. Keep the Compose stop grace period above the process's 15-second forced-exit deadline and investigate any `Graceful shutdown timed out` log before proceeding with another deployment.

## Updates

Before every update:

- confirm CI passed for the exact commit;
- review dependency and infrastructure changes;
- resolve the floating Node, Caddy, and Redis image tags to tested immutable digests for the release record;
- create and verify a current Redis backup;
- read release notes for protocol or snapshot-schema changes.

Deploy:

```sh
git pull --ff-only
docker compose config --quiet
docker compose build --pull app
docker compose up -d --remove-orphans
docker compose ps
```

Repeat the health and cross-device smoke tests. Compose replaces only changed containers; named Redis and Caddy volumes remain.

On the current 1 GB VPS, do not run a cold dependency install while the live game and the other hosted services are active; the host can become CPU/I/O saturated. When `package.json` production dependencies and the Node base image are unchanged, deploy locally verified `dist/` and `server-dist/` as an artifact-only layer:

```sh
HSC_ARTIFACT_ONLY=1 \
HSC_VPS_HOST=66.29.131.4 \
HSC_DOMAIN=cards.thoughtlesslabs.com \
HSC_ACME_EMAIL=ops@thoughtlesslabs.com \
./scripts/deploy-vps.sh
```

Use the full `Dockerfile.vps` build during a planned maintenance window whenever runtime dependencies or the base image change. Never use the artifact-only path across such a change.

## Backup and restore

Redis AOF protects against container restarts but is not an off-host backup. Schedule encrypted backups to separate storage and set a documented retention period.

Create a fresh RDB snapshot without placing the password on the host command line:

```sh
docker compose exec redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli BGSAVE'
docker compose exec redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli LASTSAVE'
```

Back up the entire `redis-data` named volume with a trusted volume-backup tool after `BGSAVE` completes. Also back up the Caddy data volume so certificate account state survives host replacement. Encrypt backups, limit operator access, and test restoration on a separate host.

For restore, stop `app` and `redis`, restore the Redis volume into the same Redis major version, start Redis, verify `PING` and logs, then start the app and Caddy. Never trial a restore against the live volume.

## Rollback

1. Keep the current Redis backup.
2. Check out the last known-good Git commit.
3. Rebuild `app` from that commit.
4. Run `docker compose up -d app` and repeat smoke tests.

Do not roll back across an incompatible snapshot-schema change without its documented migration or restore procedure. Version 1 snapshots are deliberately short-lived, but that does not replace compatibility checks.

## Secret rotation

- Rotating `SESSION_SIGNING_SECRET` invalidates every existing anonymous session. Schedule it as a user-visible maintenance event unless a future multi-key verifier is implemented.
- Rotating `REDIS_PASSWORD` requires coordinated Redis and app configuration changes. Take a backup and use a short maintenance window.
- If a secret is exposed, rotate it immediately, review access logs, invalidate affected sessions, and document the incident.

## Monitoring and maintenance

At minimum, alert on:

- `/healthz` failure or a sustained cold-start `/readyz` failure;
- repeated restarts or unhealthy containers;
- `degraded: true` or `snapshotStore` reporting memory fallback, even when `/readyz` is HTTP 200;
- TLS renewal errors;
- disk, inode, memory, and Redis-volume growth;
- bursts of HTTP 429, 403, or 5xx responses;
- global connection usage approaching `MAX_SOCKET_CONNECTIONS` or repeated per-player connection-cap rejections;
- backup age and restore-test age.

Docker log rotation is size-bounded by Compose. Review operational logs for personal information before sending them to a third-party logging platform, and update the privacy policy and store disclosures before adding telemetry.
