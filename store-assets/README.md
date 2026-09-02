# Store assets

These assets are derived from the bundled original horror-comedy party artwork and real device-family captures. They contain no store badges, rankings, prices, testimonials, or third-party branding.

Ready-to-paste English (United States) listing copy lives under `google-play/listing/en-US/` and `app-store/listing/en-US/`. Keep it synchronized with `docs/STORE_LISTING.md` and the exact submitted binary.

Regenerate them with:

```sh
pnpm store:assets
```

The checked-in Android source captures live under `source-captures/android/`. Override any one with `STORE_CAPTURE_PROFILE`, `STORE_CAPTURE_GAME`, or `STORE_CAPTURE_RESULT`; every Android input must be a verified 1440 x 3120 PNG. Generation fails if any source is missing or has the wrong dimensions, so stale outputs cannot pass silently.

Before submission, recapture all screenshots from the exact signed release build with the final production server URL. Google Play phone screenshots are exported at 1080 x 1920. The Play set is ordered active gameplay, result, then profile so the core game appears first.

App Store screenshots are deliberately not derived from Android. The checked-in iPhone source captures live under `source-captures/iphone/` and must be native 1284 x 2778 PNGs from the release build. Override them with `STORE_CAPTURE_IPHONE_PROFILE`, `STORE_CAPTURE_IPHONE_GAME`, and `STORE_CAPTURE_IPHONE_RESULT` when recapturing; generation validates every input. Version 1 is intentionally iPhone-only; enabling iPad later requires tablet QA plus a separate required iPad screenshot set.

Suggested alt text:

- Feature graphic: Four colorful supernatural party guests surround a playful skeleton peeking from a neon coffin card.
- Choose a contestant: Player setup offers eight original horror-comedy characters and a display-name field.
- Solo Game: A solo turn shows the player roster, timer, and four neon coffin-backed hiding cards.
- Round results: The surviving winner is celebrated alongside final scores and rematch controls.
