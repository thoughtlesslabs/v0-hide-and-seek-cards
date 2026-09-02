# Store listing draft

Status: copy draft for version 1.0  
Application ID: `com.thoughtlesslabs.hideandseekcards`

## Release assumptions

- Publisher name is Thoughtless Labs.
- The public game, marketing, privacy, and support origin is `https://cards.thoughtlesslabs.com`. `/privacy` and `/support` are static, indexable documents that do not start the multiplayer client.
- Version 1 is free, has no advertising, in-app purchases, external payment links, account registration, or free-form chat.
- The app is positioned as a general-audience family card game, not enrolled in Apple's Made for Kids category or Google Play's child-only target audience.
- Online play uses a production service available throughout review. Solo Game works without another player.
- Version 1 is distributed on iPhone and Android phones; iPad distribution is intentionally disabled until tablet-specific QA and screenshots are complete.

Do not paste this document into a store until every claim has been verified against the submitted binary.

## Shared positioning

One-line pitch:

> A spooky-funny guessing game where every reveal reshuffles the haunted deck and decides who survives the show.

Core features:

- Solo Game against bots
- Quick Match for four or eight players
- Private rooms with shareable codes
- Single-round, best-of-three, and best-of-five games
- Curated emoji reactions without open chat
- Anonymous play with no account required
- Sound, haptic, reduced-motion, and extra-contrast settings
- Cross-device play across web, iPhone, and Android

## Apple App Store

| Field | Draft |
| --- | --- |
| Name | Hide & Seek Cards |
| Subtitle | Mystery, luck, family fun |
| Primary category | Games |
| Primary subcategory | Card |
| Secondary subcategory | Family |
| Price | Free |
| SKU | HSC-IOS-001 |
| Bundle ID | `com.thoughtlesslabs.hideandseekcards` |
| Copyright | © 2026 Thoughtless Labs |
| Privacy Policy URL | `https://cards.thoughtlesslabs.com/privacy` |
| User Privacy Choices URL | `https://cards.thoughtlesslabs.com/privacy#your-choices-and-rights` |
| Support URL | `https://cards.thoughtlesslabs.com/support` |
| Marketing URL | `https://cards.thoughtlesslabs.com` |

### Promotional text

Gather friends or train with bots in a playful haunted game show of daring guesses and ever-changing hiding places. No account needed—choose a contestant and start seeking.

### Keywords

```text
card,game,family,mystery,guessing,multiplayer,party,friends,offline,casual
```

Recount the localized keyword field before submission; Apple limits it to 100 characters.

### Description

Every card belongs to someone—but no one knows where their own card is hiding.

Choose a player to seek and reveal one card from the haunted deck. Find your target and they are out. Reveal your own card and the trapdoor gets you instead. After every reveal, all remaining cards move before the next turn. The last player remaining wins the round.

PLAY YOUR WAY

• Train solo against bots, even when online play is unavailable  
• Jump into a four- or eight-player Quick Match  
• Create a Private Room and share its code with family and friends  
• Choose a single round, best of three, or best of five

MADE FOR THE WHOLE TABLE

• Simple rules with suspense in every reveal  
• Friendly, curated emoji reactions without open chat  
• Sound and gentle feedback with easy mute controls  
• Reduced-motion and extra-contrast options  
• No account required

Hide & Seek Cards blends luck, suspense, and laughter into a game that is quick to learn and different every turn.

Online modes require an internet connection. Solo Game is available without other players.

### App Review notes draft

```text
Hide & Seek Cards does not require registration or a demo account.

Fastest review path:
1. Create a local player card using any nickname and bundled avatar.
2. On Home, select Solo Game.
3. Complete a turn by choosing a target and revealing a card.

Online review:
- Quick Match fills remaining seats with bots after its matchmaking wait.
- A Private Room can be started by its host and fills empty seats with bots. To verify joining, create a room on one device/browser and enter the displayed six-character code on another.
- The production multiplayer service is https://cards.thoughtlesslabs.com.

There is no free-form user chat, advertising, purchase flow, external payment link, account login, or user-uploaded content. Reactions are limited to a fixed emoji set. Network access is used only for anonymous multiplayer and service security.
```

Verify the exact navigation against the signed submission build before submission.

## Google Play

| Field | Draft |
| --- | --- |
| App name | Hide & Seek Cards |
| Default language | English (United States) |
| Application ID | `com.thoughtlesslabs.hideandseekcards` |
| App or game | Game |
| Category | Card |
| Tags | Card, Casual, Family, Multiplayer |
| Monetization | Free; no ads; no in-app products |
| Privacy Policy URL | `https://cards.thoughtlesslabs.com/privacy` |
| Developer website | `https://cards.thoughtlesslabs.com` |
| Support email | `support@thoughtlesslabs.com` |

Confirm that the support mailbox is monitored before publishing.

### Short description

A family card game of moving cards, daring guesses, and friendly play.

### Full description

Every card belongs to someone, but no one knows where their own card is hiding.

In Hide & Seek Cards, you choose a player to seek and reveal one card from the haunted deck. Find your target and they are eliminated. Reveal your own card and the trapdoor gets you instead. After every reveal, all remaining cards change position before the next player chooses. Be the last player remaining to win.

CHOOSE YOUR GAME

• Play Solo Game against bots  
• Find a four- or eight-player Quick Match  
• Create a Private Room for family and friends  
• Play one round, best of three, or best of five

FRIENDLY BY DESIGN

• No account required  
• Curated emoji reactions with no open chat  
• Bundled character art that works offline  
• Sound, haptic, reduced-motion, and extra-contrast controls  
• Cross-device online play

The rules are simple, and every reveal sends the cards to new hiding places. Hide & Seek Cards is made for quick rounds, family game nights, and friends playing from different devices.

Online modes require an internet connection. Solo Game is available without other players.

## Preliminary age/content answers

These are working notes, not final ratings:

- Cartoon/fantasy violence: mild comic peril and elimination language with playful skull, ghost, coffin, and trapdoor imagery; no weapons, injury, blood, or gore.
- Gambling: none. Cards are randomized, but there is no wagering, purchasable chance, cash value, or prize.
- Loot boxes: none.
- User-generated content: players choose a short display name; reactions come from a fixed emoji list. Treat display names as limited user-generated text and confirm moderation/reporting expectations with each store.
- Users interact online: yes, through shared game state, display names, and curated reactions.
- Location sharing: no.
- Unrestricted web access: no.
- Advertising: no.
- In-app purchases: no.

Answer the current Apple age-rating questionnaire and Google IARC questionnaire from the submitted build. Do not assume a numeric rating from these notes.

## Preliminary privacy disclosures

Final declarations must be checked against server, proxy, platform, and SDK behavior.

Apple App Privacy working classification:

- User ID: anonymous random session/player ID, used for app functionality; not used for tracking.
- User Content: chosen display name and curated reaction, used for app functionality.
- Usage Data/Product Interaction: room membership, game actions, scores, and connection state, used for app functionality.
- Diagnostics: error and request metadata if retained in operational logs, used for app functionality/security.
- Tracking: no.

Google Play Data Safety working classification:

- Data collected: user IDs, app interactions, and diagnostics/technical identifiers used for multiplayer, security, and reliability.
- Data sharing: service providers process data on the operator's behalf; no sale or advertising sharing.
- Encryption in transit: yes.
- Account deletion: no accounts exist. Explain local reset/uninstall and automatic snapshot expiration in the privacy policy.
- Ephemeral processing: do not mark all gameplay ephemeral because Redis snapshots can persist for up to the configured TTL.

## Asset plan

The reproducible asset pipeline is `pnpm store:assets`. Google Play artwork is written to `store-assets/google-play/`; the opaque Apple icon is written to `store-assets/app-store/icon-1024.png`. Store screenshots must ultimately come from the exact signed release binaries with the production origin embedded.

Apple:

- 1024 x 1024 App Store icon, opaque and without baked rounded corners;
- three native 6.5-inch iPhone captures at 1284 x 2778, matching the dimensions accepted by this App Store Connect version record;
- no iPad screenshots for version 1 because the Xcode target is intentionally iPhone-only;
- optional app preview video after gameplay is final.

Google:

- 512 x 512 high-resolution icon;
- 1024 x 500 feature graphic;
- three 1080 x 1920 phone screenshots generated from verified 1440 x 3120 Android captures;
- no store badges, misleading rankings, prices, or tiny unreadable text in artwork.

Submission screenshot story:

1. Active game board with a complete target prompt and timer
2. Player-win result with scores and replay controls
3. Completed player profile showing the bundled companion art
4. Private Room with a second real client, if a fourth screenshot is used
5. Accessibility settings, if a fifth screenshot is used

Confirm the inventory in [ASSET_PROVENANCE.md](./ASSET_PROVENANCE.md), original generation records, tool terms, dependency licenses, and publisher approval before submission.
