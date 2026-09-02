# Achievement integration

The game records achievement progress locally through `src/lib/achievements.ts`. Its canonical IDs are deliberately independent of any store:

| Canonical ID | Unlock condition |
| --- | --- |
| `tutorial_complete` | Finish the interactive tutorial |
| `first_flip` | Flip a card |
| `first_find` | Find the selected target |
| `trapdoor_tourist` | Reveal your own card |
| `survivor` | Win a match |
| `social_spirit` | Send an online reaction |
| `full_table` | Start an 8-player match |
| `haunted_regular` | Finish 10 matches |

## Platform adapters

An adapter implements `AchievementProvider` and maps each canonical ID to the ID configured in the platform dashboard. Registering a provider immediately sends the latest local percentage for every achievement, so offline progress can catch up after sign-in.

```ts
await achievements.registerProvider({
  id: "google-play-games",
  async reportProgress(canonicalId, percentComplete) {
    const platformId = GOOGLE_IDS[canonicalId]
    await nativeGoogleBridge.reportAchievement(platformId, percentComplete)
  },
})
```

Use the same shape for Apple Game Center and Steam. The store IDs and native SDK credentials cannot be finalized until the corresponding developer accounts and app records exist. Do not rename the canonical IDs after store records are created.

Platform behavior:

- Google Play Games: unlock one-step achievements at 100%; report incremental steps for `haunted_regular`.
- Apple Game Center: report `percentComplete` from 0 through 100.
- Steam: call `SetAchievement` at 100%; optionally mirror partial progress with a stat.

Local progress remains authoritative when a platform service is unavailable. Provider failures must never block gameplay.
