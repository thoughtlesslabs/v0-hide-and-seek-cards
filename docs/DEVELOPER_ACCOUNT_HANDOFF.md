# Developer account handoff

Everything in this document requires an Apple Developer/App Store Connect or Google Play Console identity. The public service, legal URLs, store copy, Android upload identity, app-link scaffolding, and local Android release candidate are prepared before this handoff.

## Shared release identity

| Field | Value |
| --- | --- |
| App name | Hide & Seek Cards |
| Publisher | Thoughtless Labs |
| Bundle/application ID | `com.thoughtlesslabs.hideandseekcards` |
| Website | `https://cards.thoughtlesslabs.com` |
| Privacy policy | `https://cards.thoughtlesslabs.com/privacy` |
| Privacy choices | `https://cards.thoughtlesslabs.com/privacy#your-choices-and-rights` |
| Support | `https://cards.thoughtlesslabs.com/support` |
| Support email | `support@thoughtlesslabs.com` |
| Privacy email | `privacy@thoughtlesslabs.com` |

The support and privacy addresses forward to the existing `contact@thoughtlesslabs.com` mailbox. Confirm that mailbox is monitored before submission.

## Apple account steps

1. Enroll Thoughtless Labs in the Apple Developer Program and grant App Store Connect access with MFA and recovery coverage.
2. Register `com.thoughtlesslabs.hideandseekcards`, enable Associated Domains, and create the App Store Connect app record.
3. Record the Apple Team ID. Use it to publish `/.well-known/apple-app-site-association`; never substitute a guessed Team ID.
4. Select the Thoughtless Labs team in Xcode, create distribution signing, archive, validate, and upload the exact release build.
5. Complete App Privacy, the current age-rating questionnaire, export-compliance answers, territories, price, review contact, and the listing fields in [STORE_LISTING.md](./STORE_LISTING.md).
6. Capture the required iPhone screenshots from the signed candidate and complete TestFlight testing before review.

## Google account steps

1. Complete Play Console identity verification, create the app with package `com.thoughtlesslabs.hideandseekcards`, and enable Play App Signing.
2. Add the Play App Signing SHA-256 certificate fingerprint to `public/.well-known/assetlinks.json`, redeploy, and verify the Play-delivered app links.
3. Upload `android/app/build/outputs/bundle/release/app-release.aab` to Internal testing. Never upload or share the upload keystore.
4. Complete App content, IARC content rating, target audience, ads declaration, App access, Data Safety, privacy URL, contact details, and the listing fields in [STORE_LISTING.md](./STORE_LISTING.md).
5. Install the Play-delivered build on physical devices and run the release matrix before promotion.
6. If the Play developer identity is a personal account created after November 13, 2023, complete Google's required closed test before applying for production access.

## Signing identities

- Android upload certificate SHA-256: `CC:29:05:FD:CC:1B:E4:32:63:BA:E3:34:32:27:EA:E4:83:0A:0E:F4:89:57:35:74:DC:FF:A3:82:7F:1F:D2:43`
- Google Play App Signing certificate SHA-256: `B0:2A:A7:00:5D:39:C8:B8:EC:37:AC:E6:A9:2E:C6:49:B6:C0:22:CF:82:91:91:B2:20:F8:3A:26:4F:78:96:54`
- Apple Team ID: `4SF8573TA6`
- The Android upload keystore is outside Git under the local Thoughtless Labs application-support folder; passwords are stored in macOS Keychain.
- Store the keystore in an encrypted off-device organizational backup before uploading the first bundle.

## Submission evidence

- Store copy and disclosure drafts: [STORE_LISTING.md](./STORE_LISTING.md)
- Release gates: [STORE_RELEASE_CHECKLIST.md](./STORE_RELEASE_CHECKLIST.md)
- Native build and signing guide: [NATIVE_RELEASE.md](./NATIVE_RELEASE.md)
- Asset inventory: [ASSET_PROVENANCE.md](./ASSET_PROVENANCE.md)
- Privacy source: [PRIVACY_POLICY.md](./PRIVACY_POLICY.md)
