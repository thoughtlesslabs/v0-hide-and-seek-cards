# Hide & Seek Cards

A production-oriented, family-friendly guessing card game for the web, iPhone, and Android. Players choose someone to seek and reveal one hiding place. After every reveal, all remaining cards move before the next player's turn.

## What is included

- Bundled React/Vite game client with offline solo play
- Capacitor 8 projects for iOS and Android
- Server-authoritative Socket.IO multiplayer with signed anonymous sessions
- Private six-character room codes and public matchmaking
- Redis-backed game snapshots with an in-memory development fallback
- Responsive phone, tablet, landscape, safe-area, reduced-motion, and high-contrast layouts
- Eight locally bundled character portraits, native icon, splash screen, sound cues, and haptics
- Docker Compose deployment with Caddy HTTPS/WSS and Redis persistence

## Local development

Requirements: Node.js 22–26 and pnpm 11.

```bash
pnpm install
pnpm dev
```

The client runs at `http://localhost:5173`; the game server runs at `http://localhost:8787`. Redis is optional in development.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

## Native apps

Build and sync the bundled client:

```bash
VITE_GAME_SERVER_URL=https://play.example.com pnpm cap:sync:release
pnpm cap:open:ios
pnpm cap:open:android
```

Release builds intentionally do not use Capacitor `server.url`; the game client is packaged inside each app. Replace the example server URL with the deployed HTTPS origin before syncing. The release-sync command rejects missing, local, non-HTTPS, and placeholder origins.

Every client build also emits `native-release.json` plus an equivalent iOS property-list marker. Android and iOS Release builds compare their marker with the packaged JavaScript and fail before packaging if the final validated origin is missing or stale. Development builds and the same-origin web deployment remain unaffected.

See [Native release](docs/NATIVE_RELEASE.md) and [Store release checklist](docs/STORE_RELEASE_CHECKLIST.md).

## VPS deployment

Copy `.env.example` to `.env`, set the domain and generated secrets, then follow [Deployment](docs/DEPLOYMENT.md). The initial production shape is one authoritative game-server replica behind Caddy plus Redis with AOF persistence.

Architecture, privacy, and release-art ownership details are in [Architecture](docs/ARCHITECTURE.md), [Privacy policy](docs/PRIVACY_POLICY.md), and [Asset provenance](docs/ASSET_PROVENANCE.md).
