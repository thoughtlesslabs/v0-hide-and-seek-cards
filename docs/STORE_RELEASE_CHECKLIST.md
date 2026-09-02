# Store release checklist

All boxes are deliberately unchecked. The release owner should attach evidence to each completed gate.

## Ownership and identity

- [ ] Thoughtless Labs is the legal publisher and owns `com.thoughtlesslabs.hideandseekcards`.
- [ ] App name and trademark conflicts have been checked in launch countries.
- [ ] Apple Developer and Google Play accounts are verified, secured with MFA, and have at least two recovery-capable administrators.
- [ ] Final public domain, privacy URL, support URL, and monitored privacy/support email addresses are live over HTTPS.
- [ ] Version, build number, copyright holder, SKU, countries, price, and tax settings are approved.
- [ ] Version 1's recorded iPhone-only scope is confirmed; any future iPad expansion has separate layout, device, and screenshot evidence.
- [ ] Target audience is recorded; any child-directed distribution has a separate legal and store-policy review.

## Engineering gates

- [ ] `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- [ ] `pnpm lint` passes with no warnings.
- [ ] `pnpm typecheck` passes without suppressed errors.
- [ ] `pnpm test:run` passes, including engine, protocol, auth, concurrency, reconnect, and projection tests.
- [ ] `pnpm build:client` and `pnpm build:server` pass.
- [ ] Docker image builds in CI and production Compose validates.
- [ ] Node, Caddy, and Redis images are recorded or pinned by tested immutable digest for production.
- [ ] No release build contains a source-map URL, development server URL, localhost API URL, debug menu, test credential, or secret.
- [ ] Software composition/dependency audit is reviewed and critical vulnerabilities are resolved.
- [ ] No unauthenticated administrative or destructive endpoint is reachable.
- [ ] Hidden game state is absent from client snapshots and logs.
- [ ] Rate limits, payload limits, HTTP and WebSocket origin checks, timed/per-action session expiry, pre-auth transport connection ceilings, and graceful shutdown reconnect/draining are tested.

## Production service

- [ ] DNS, TLS, Caddy headers, WebSocket upgrades, and only public ports 80/443 are verified externally.
- [ ] `.env` secrets are randomly generated, permission-restricted, backed up securely where necessary, and absent from Git/history/logs.
- [ ] `/healthz` and `/readyz` are monitored.
- [ ] `/readyz` reports Redis-backed state rather than memory fallback.
- [ ] A cold start during a Redis outage keeps liveness and Solo/web assets available, rejects online actions, stays unready, then rehydrates persisted rooms after Redis returns without restarting the app.
- [ ] A runtime Redis outage or stalled command returns to play within `REDIS_OPERATION_TIMEOUT_MS`, stays routable, and reports degraded persistence until all buffered writes and tombstones drain.
- [ ] Redis AOF survives app, Redis, and host restart tests.
- [ ] Encrypted off-host backup and separate-host restore tests pass.
- [ ] Disk, memory, certificate, error-rate, restart, and backup-age alerts are active.
- [ ] Capacity/load test meets the expected concurrent game target with headroom.
- [ ] Rollback is rehearsed for the exact snapshot/protocol version.
- [ ] Production remains available throughout TestFlight, Play testing, and store review.

## Privacy, safety, and legal

- [ ] [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) has legal/operator review and is published at the submitted URL.
- [ ] Operator and monitored contact details in the policy are correct.
- [ ] Data inventory covers client storage, session tokens, display names, reactions, game snapshots, IP/user-agent/access logs, backups, Caddy, Redis, Apple, Google, and every SDK.
- [ ] Apple App Privacy and Google Data Safety answers match the submitted binaries and server retention.
- [ ] iOS privacy manifest contains every required-reason API and embedded SDK manifest.
- [ ] No tracking permission or advertising identifier is present.
- [ ] No external Stripe/donation/payment link is present in native UI.
- [ ] Any future digital purchase uses approved store billing and has restore/refund handling.
- [ ] Display-name validation, friendly-name guidance, abuse response, and store UGC requirements are reviewed.
- [ ] Content, font, portrait, icon, sound, and promotional-art ownership records are archived.
- [ ] Export-compliance/encryption questions are answered accurately.

## Native configuration

- [ ] `capacitor.config.ts` uses the final app ID, `webDir: "dist"`, and no production `server.url`.
- [ ] Native bundle embeds the final `https://` API origin.
- [ ] Android and iOS Release origin gates pass and `native-release.json` matches the exact origin embedded in packaged JavaScript.
- [ ] Backend allowlist includes exact web, iOS, and Android origins without `*`.
- [ ] Icons, adaptive icon layers, splash screens, launch backgrounds, and dark-mode behavior pass visual QA.
- [ ] Safe areas, edge-to-edge, dynamic viewport, keyboard, system bars, and gesture navigation work.
- [ ] Android predictive/hardware back and iOS navigation gestures behave intentionally.
- [ ] App suspend/resume performs a fresh authoritative state sync.
- [ ] Offline Solo Game cold-launches with airplane mode and no external asset requests.
- [ ] Sound, haptics, reduced motion, extra contrast, VoiceOver/TalkBack, focus order, labels, and text scaling pass QA.
- [ ] Universal/App Links work for installed cold start, warm start, and website fallback.
- [ ] Invite links never expose a session token or other credential.

## iOS and App Store Connect

- [ ] The generated Capacitor 8 project is reviewed after identity approval; it is regenerated if the approved app identity differs.
- [ ] Xcode 26+ and current required SDK are used.
- [ ] Signing team, bundle ID, entitlements, deployment target, devices, orientations, version, and build are correct.
- [ ] Release configuration has no unintended permissions or background modes.
- [ ] `PrivacyInfo.xcprivacy` and third-party SDK signatures pass validation.
- [ ] Archive validation completes without unresolved warnings.
- [ ] Internal and external TestFlight builds pass the release test matrix.
- [ ] App icon and required screenshots are uploaded for every supported device family.
- [ ] Name, subtitle, description, keywords, categories, URLs, age rating, privacy label, review notes, and contact details are final.
- [ ] Review notes provide a working Solo Game path and explain how to test online play without an account.
- [ ] App Review has no dependency on a developer-only VPN, allowlisted reviewer IP, or temporary credential.

## Android and Play Console

- [ ] Android Studio 2025.2.1+ and its supported JDK are used.
- [ ] `minSdkVersion` 24 and target/compile SDK 36 are confirmed for Capacitor 8.
- [ ] Upload key is generated outside Git, encrypted backups exist, and Play App Signing is enabled.
- [ ] `test`, `lint`, and `bundleRelease` pass.
- [ ] Play-delivered internal-track AAB is installed and tested on physical devices.
- [ ] Adaptive icon, 512 icon, 1024 x 500 feature graphic, and required screenshots are final.
- [ ] Store listing, app access, ads declaration, content rating, target audience, Data Safety, privacy URL, and contact details are final.
- [ ] Pre-launch report, automated device testing, crash/ANR, and policy results have no unresolved blocker.
- [ ] Verified App Links use the Play App Signing certificate fingerprint.

## Cross-device release test

- [ ] Full Solo Game game completes offline.
- [ ] Four-player Quick Match completes across web/iOS/Android.
- [ ] Eight-player match completes under expected production load.
- [ ] Private Room create/join/start works through shared code and invite link.
- [ ] Host departure, player departure, bot replacement, disconnect grace, timeout, elimination, series end, and rematch behave correctly.
- [ ] Duplicate, delayed, reordered, and retried commands do not corrupt state.
- [ ] Wi-Fi/cellular handoff, airplane mode, background/resume, app force-stop, API restart, and Redis restart recover safely.
- [ ] Small phone, large phone, supported tablet/foldable, portrait/landscape policy, and maximum text size have no clipping or unreachable controls.

## Submission and launch

- [ ] Exact Git commit, dependency lockfile, Docker image identifier, native archives, symbols, store metadata, and screenshots are retained.
- [ ] Phased release/staged rollout and rollback owners are assigned.
- [ ] Support, incident response, privacy requests, server monitoring, and store-review messages have on-call owners.
- [ ] Release notes are accurate and contain no unsupported claims.
- [ ] Post-launch smoke test covers install, first run, Solo Game, Quick Match, Private Room, and reconnect.
- [ ] Crash/ANR, server health, matchmaking latency, disconnect rate, resource use, reviews, and support requests are watched during rollout.
- [ ] A retrospective and next-update dependency/SDK deadline are scheduled.
