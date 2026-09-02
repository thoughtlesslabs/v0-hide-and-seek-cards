# Native release guide

This guide covers the release path for the bundled Capacitor app. The `ios/` and `android/` projects have been generated and are part of the workspace. Android has a locally validated, upload-key-signed App Bundle; iOS signing remains blocked on the Apple developer identity.

## Fixed decisions

- Capacitor major version: 8
- Application and bundle ID: `com.thoughtlesslabs.hideandseekcards`
- Display name: `Hide & Seek Cards`
- Bundled web directory: `dist`
- Production transport: HTTPS and WSS only
- Minimum app targets: iOS 15.4 and Android API 24
- Android compile/target SDK for Capacitor 8: API 36
- Version 1 iOS distribution: iPhone only (`TARGETED_DEVICE_FAMILY = 1`)
- Production builds must not set `server.url`, `allowMixedContent`, cleartext traffic, or a broad navigation allowlist.

Changing the application ID after creating store records produces a different app. Confirm Thoughtless Labs owns this identifier before creating either store record; if it does not, change the ID and regenerate the native projects before submission work begins.

## Toolchain prerequisites

| Tool | Required for this project |
| --- | --- |
| Node.js | 22 LTS or a supported newer version from `package.json` |
| pnpm | 11.10.0 |
| Xcode | 26.0 or newer, with the current iOS SDK |
| Android Studio | 2025.2.1 or newer |
| Android SDK | Platform 36 and the build tools requested by Gradle |
| Android JDK | JDK 21 (set `HSC_JAVA_HOME` when it is not installed through Homebrew) |
| Apple | Active Apple Developer Program membership and App Store Connect access |
| Google | Play Console developer account with identity verification complete |

The native projects were generated successfully with the Capacitor CLI. Android command-line builds work with the installed SDK and JDK 21. Do not rely on the current Android Studio bundled JDK when it is newer than 21; Gradle 8.14 can launch on a newer runtime while its Groovy compiler still rejects that runtime's class-file version.

### Current workspace validation status

Current release evidence:

- Android has a current tester APK signed with the standard Android Debug certificate and a release App Bundle signed by the Thoughtless Labs upload certificate. The upload keystore lives outside the repository, its passwords are in macOS Keychain, and `pnpm android:release` reproduces the guarded, tested, linted, shrunk, signed bundle. Back up the upload keystore in an encrypted organizational vault before the first Play upload.
- Android and iOS currently contain synchronized `native-release` web bundles targeting `https://cards.thoughtlesslabs.com`, and both release-origin gates validate that exact origin. Repeat the guarded sync from the exact release commit before producing each signed store candidate.
- Xcode 26.6, the iOS 26.5 SDK/runtime, and current simulators are installed. Unsigned Debug and Release simulator builds succeed, including the Release production-origin gate. Store signing, physical-device distribution, archiving, and TestFlight still require the Apple developer identity.
- The Xcode target has no Apple Development Team, distribution certificate, or provisioning profile configured. No signed `.xcarchive` or `.ipa` has been produced; simulator products must not be distributed.

Do not treat the ignored files under native `build/` directories as release evidence. A release is ready only after the final domain is embedded, platform signing succeeds, the store-delivered binary passes the device/network matrix, and the applicable checklist items are complete.

## Release configuration

Create an untracked `.env.production.local` for native release builds:

```dotenv
VITE_GAME_SERVER_URL=https://cards.thoughtlesslabs.com
```

This URL is public and becomes part of the bundled JavaScript. Never place `SESSION_SIGNING_SECRET`, Redis credentials, signing passwords, API private keys, or other secrets in a `VITE_` variable.

The API must allow these exact native origins in addition to the web origin:

```text
capacitor://localhost
https://localhost
http://localhost
```

The last origin supports Capacitor compatibility. Do not add a wildcard.

## Native project generation

The first native generation has already been completed. For normal work, keep the reviewed native projects and use the routine sync below. If a platform directory is intentionally removed and recreated, first preserve any reviewed native settings and confirm the bundle ID, final icon, team ownership, supported devices, orientation policy, and public domain, then run the applicable `cap:add` command:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:run
pnpm build:client
# Run only for a platform directory that does not exist:
pnpm cap:add:ios       # or: pnpm cap:add:android
pnpm native:assets
pnpm cap:sync
```

Capacitor 8 creates a Swift Package Manager iOS project by default. Do not switch to CocoaPods unless a selected native plugin requires it.

The source asset checks already pass at the base level:

- `assets/icon-only.png`: 1024 x 1024, no alpha;
- `assets/splash.png`: 2732 x 2732;
- `assets/android-icon-background.svg`, `assets/android-icon-foreground.svg`, and `assets/android-icon-monochrome.svg`: explicit adaptive and themed-icon layers.

`pnpm native:assets` runs Capacitor's generator and then the deterministic Android layer generator, so regenerating assets cannot restore the default Capacitor foreground. Before each release, still verify the icon under circle, squircle, and themed masks and confirm the splash artwork on light/dark displays and extreme aspect ratios.

## Routine native sync

After any client or native-plugin change during development:

```sh
pnpm typecheck
pnpm test:run
pnpm build:client
pnpm exec cap sync
```

For a release candidate, use the guarded sync so a native binary cannot silently target its device-local WebView:

```sh
VITE_GAME_SERVER_URL=https://cards.thoughtlesslabs.com pnpm cap:sync:release
```

The guard accepts only a real HTTPS origin on the default port with no credentials, path, query, fragment, IP address, local/reserved suffix, or trailing DNS dot. Replace the example hostname; it is intentionally rejected.

Every Vite build writes `native-release.json` plus an equivalent `native-release.plist` beside `index.html`:

- a normal same-origin web/development build records `mode: "web-same-origin"` and no server origin;
- a build with an approved `VITE_GAME_SERVER_URL` records `mode: "native-release"` and the normalized origin.

Android's Release APK/AAB packaging tasks and the iOS target's Release verification phase require schema version 1, `native-release` mode, a valid HTTPS origin, and the exact same origin inside the synchronized JavaScript. Consequently, running Gradle or Xcode directly cannot silently package the last development sync. Debug builds and Android lint remain available for offline/local engineering work. CI uses a clearly labeled, non-published validation origin only to compile the Release configurations; it never produces the store artifact.

Review every generated native diff before committing it. Never copy a developer `.env`, provisioning profile, signing key, `local.properties`, or DerivedData into Git.

## iOS setup

In Xcode:

1. Select the Thoughtless Labs team and enable automatic signing for development.
2. Confirm bundle ID `com.thoughtlesslabs.hideandseekcards`.
3. Set the marketing version and monotonically increasing build number.
4. Keep the deployment target at iOS 15.4 or newer; the interface relies on Safari 15.4 cascade layers and native dialogs.
5. Keep version 1 iPhone-only unless the release scope is deliberately expanded and iPad layouts, device QA, and screenshots are completed first.
6. Set supported orientations deliberately. Portrait-only is acceptable for phone version 1 only after testing; large-screen and accessibility layouts must not depend solely on an orientation lock.
7. Use a dark launch background consistent with `#120d24` and verify status-bar contrast and safe-area padding on notched devices.
8. Do not enable background modes, advertising identifiers, camera, microphone, contacts, location, photo-library, or tracking permissions without an implemented feature and a privacy review.

### iOS privacy manifest

The app target includes `PrivacyInfo.xcprivacy` declarations for anonymous user IDs, gameplay content, product interaction, diagnostics, and no tracking. Capacitor and Cordova also ship their SDK manifests. After the final plugin graph is synced, generate Xcode's aggregate privacy report and run Apple's required-reason API validation; change declarations only when they match the submitted binary and current Apple documentation.

The App Store privacy label is separate from the binary privacy manifest. Both must match the shipped behavior and every embedded SDK.

### iOS deep links

Before enabling Associated Domains:

- use the final invite URL form `https://cards.thoughtlesslabs.com/join/ROOMCODE`;
- implement and test `appUrlOpen` routing in the client;
- host `/.well-known/apple-app-site-association` over HTTPS with the final Apple Team ID and bundle ID;
- keep `applinks:cards.thoughtlesslabs.com` in the target entitlement;
- test installed, cold-start, warm-start, and website-fallback behavior on a physical device.

Do not create the association file with a guessed Team ID.

### iOS archive

1. Run all repository quality gates and `pnpm cap:sync:release` with the final production origin. A normal `pnpm cap:sync` is intentionally rejected by Release builds.
2. Build and test a Release configuration on physical devices.
3. Product > Archive in Xcode.
4. Run Validate App and resolve every warning.
5. Upload to App Store Connect and test through TestFlight internal, then external testing.
6. Compare the TestFlight binary's version, API origin, icons, privacy manifest, permissions, and offline behavior with the release checklist.

## Android setup

In Android Studio:

1. Confirm application ID `com.thoughtlesslabs.hideandseekcards`.
2. Keep `minSdkVersion` 24 and `compileSdkVersion`/`targetSdkVersion` 36 for Capacitor 8.
3. Use JDK 21 rather than the system JDK 26 or Android Studio's newer bundled JDK for Gradle. The release helper prefers Homebrew `openjdk@21` and accepts `HSC_JAVA_HOME` as an explicit override.
4. Verify edge-to-edge insets, gesture navigation, keyboard resize, predictive back, dark system bars, and adaptive layouts.
5. Do not request permissions that the game does not use.
6. Keep the existing upload key backed up outside the repository and enroll the app in Play App Signing.

Copy `android/keystore.properties.example` to the ignored `android/keystore.properties` file and provide all four values, or set the equivalent `HSC_RELEASE_STORE_FILE`, `HSC_RELEASE_STORE_PASSWORD`, `HSC_RELEASE_KEY_ALIAS`, and `HSC_RELEASE_KEY_PASSWORD` values in CI. Partial configuration fails the Gradle build instead of silently producing an unintended artifact. Keep the upload key and passwords out of Git, shell history, and build logs.

### Android app links

- Add a verified HTTPS intent filter for the final `/join/*` path.
- `/.well-known/assetlinks.json` authorizes the standard local debug certificate for directly distributed tester APKs, the Thoughtless Labs upload certificate, and the Google Play App Signing certificate.
- Keep the debug fingerprint only while direct tester APK links need to open in-app.
- Test `adb shell am start` links plus links tapped from messaging/email on physical devices.

Do not treat the debug association as store verification evidence. The Play-delivered build is verified only after the Play App Signing fingerprint is present and the installed store artifact passes Android's domain-verification checks.

### Android bundle

After the guarded release sync and Release testing, use the repository helper. It reads the upload-key passwords from macOS Keychain and forces the Android signing graph to rerun so a stale Gradle task result cannot omit the final bundle:

```sh
pnpm android:release
```

Upload the signed Android App Bundle (`.aab`) to an internal Play track first. Install the Play-delivered artifact, not only an Android Studio debug build, before promotion.

## Required device and network matrix

- Small and large iPhones, including a notched device; current and oldest supported iOS.
- iPad sizes only after a future release deliberately enables iPad distribution.
- Small Android phone, modern edge-to-edge phone, and at least one Android tablet/foldable layout.
- Text scaling, VoiceOver/TalkBack, reduced motion, high contrast, light/dark system chrome.
- Wi-Fi to cellular handoff, airplane mode, high latency, packet loss, API restart, Redis restart, background/resume beyond the disconnect grace period.
- Two to eight mixed web/iOS/Android clients through matchmaking, private rooms, rematches, host departure, and reconnects.
- Offline Solo Game after a cold launch with no network.

## Release artifacts and secret handling

- App Store Connect receives the Xcode archive through the supported uploader.
- Play Console receives an AAB, never the upload keystore.
- Signing passwords belong in the local keychain or CI secret manager, never source files or command-line logs.
- Store screenshots, metadata, privacy answers, review notes, SBOM/dependency inventory, and the exact Git commit should be archived with each release.
- Preserve upload keys, Apple team recovery access, and store account recovery codes in an organizational secrets vault with at least two authorized maintainers.
