import { useEffect, type ReactNode } from "react"
import { AppLink } from "../components/AppLink"

const PRIVACY_EMAIL = "privacy@thoughtlesslabs.com"
const SUPPORT_EMAIL = "support@thoughtlesslabs.com"

function PublicPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${title} · Hide & Seek Cards`
    return () => {
      document.title = previousTitle
    }
  }, [title])

  return (
    <div className="public-page">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="public-header">
        <AppLink className="public-brand" href="/" aria-label="Hide & Seek Cards home">
          <span aria-hidden="true">✦</span>
          <span><strong>Hide &amp; Seek Cards</strong><small>Mystery loves company</small></span>
        </AppLink>
        <nav aria-label="Public information">
          <AppLink href="/privacy" aria-current={eyebrow === "Privacy" ? "page" : undefined}>Privacy</AppLink>
          <AppLink href="/support" aria-current={eyebrow === "Support" ? "page" : undefined}>Support</AppLink>
        </nav>
      </header>

      <main id="main-content" className="public-content">
        <header className="public-intro">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        <article className="public-article">{children}</article>
      </main>

      <footer className="public-footer">
        <p>Hide &amp; Seek Cards · Version 1.0.0</p>
        <AppLink href="/">Return to the game</AppLink>
      </footer>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <PublicPage
      eyebrow="Privacy"
      title="Privacy Policy"
      description="How Hide & Seek Cards handles information on your device and during online play."
    >
      <p className="public-effective-date"><strong>Effective date:</strong> July 13, 2026</p>
      <p>Thoughtless Labs (“we,” “us,” or “our”) operates Hide &amp; Seek Cards on the web and as mobile applications. This policy explains what information the game handles, why it is handled, and the choices available to players.</p>

      <section id="privacy-summary">
        <h2>Summary</h2>
        <p>Hide &amp; Seek Cards does not require an account. We do not sell personal information, serve third-party advertising, or use information for cross-app tracking. After you create a player card, an online device may contact our multiplayer service to check availability and resume an interrupted room. Solo Game gameplay stays on your device.</p>
      </section>

      <section id="information-stored-on-your-device">
        <h2>Information stored on your device</h2>
        <p>The game stores the following locally so it can remember your choices:</p>
        <ul>
          <li>a randomly generated local player identifier;</li>
          <li>the display name and bundled avatar you choose;</li>
          <li>sound, haptic, motion, and contrast preferences;</li>
          <li>an expiring anonymous multiplayer session token; and</li>
          <li>temporary app-shell files needed for offline loading on supported browsers.</li>
        </ul>
        <p>Use <strong>Reset local data</strong> in Settings to remove your player identifier, player card, preferences, and anonymous session token from the app. You can also clear the site’s storage or uninstall the app. Browser or operating-system controls remain authoritative for cached app-shell files.</p>
      </section>

      <section id="information-handled-when-the-app-connects">
        <h2>Information handled when the app connects</h2>
        <p>When a saved player card opens on an online device, the app may connect to our multiplayer service before you choose a mode so it can report availability and resume an interrupted room. When you use Quick Match or a Private Room, the service also receives and processes:</p>
        <ul>
          <li>a random anonymous player and session identifier;</li>
          <li>the display name and avatar identifier you chose;</li>
          <li>room membership, invite codes, game settings, turns, card selections, scores, rematch votes, and curated emoji reactions;</li>
          <li>connection and timing information needed to detect disconnects and restore a game; and</li>
          <li>the app protocol and version information needed for compatibility.</li>
        </ul>
        <p>Other people in the same room can see your display name, avatar, game status, score, and reactions. Choose a nickname and do not enter your real name or other contact information.</p>
      </section>

      <section id="technical-and-security-information">
        <h2>Technical and security information</h2>
        <p>Like most internet services, our hosting systems may process IP addresses, user-agent or device and browser details, request timestamps, error details, rate-limit events, and security logs. We use this information to deliver the service, diagnose failures, prevent abuse, and protect players and infrastructure.</p>
        <p>The current release does not include a third-party advertising or behavioral analytics SDK. If telemetry is added later, this policy and the app-store privacy disclosures will be updated before release.</p>
      </section>

      <section id="how-we-use-information">
        <h2>How we use information</h2>
        <p>We use information only to create and verify anonymous sessions; match players and synchronize games; resume interrupted games and enforce rules; maintain security and troubleshoot failures; and comply with applicable law or enforce our rights.</p>
        <p>We do not use multiplayer information to build advertising profiles or make decisions about employment, credit, insurance, housing, or similar eligibility.</p>
      </section>

      <section id="retention">
        <h2>Retention</h2>
        <p>Anonymous session tokens normally expire after 30 days. Active room snapshots are configured to expire 24 hours after their last update by default. Shorter-lived connection and reaction data expires sooner.</p>
        <p>Access, security, and error logs are rotated and kept only as long as reasonably necessary for reliability, abuse prevention, incident response, and legal obligations. Encrypted operational backups may retain expired records for a limited backup cycle before being overwritten.</p>
        <p>Because there is no account directory, we may be unable to locate an anonymous record unless you provide the relevant session or room information before it expires.</p>
      </section>

      <section id="sharing">
        <h2>Sharing</h2>
        <p>We may share information only with infrastructure providers that host the application, networking, backups, or Redis data on our behalf; Apple and Google as needed to distribute the apps and diagnose store-delivered crashes; professional advisers or authorities when required by law or reasonably necessary to protect rights, safety, and service security; or a successor involved in a merger, acquisition, or asset transfer.</p>
        <p>Service providers may process information only for the services they provide to us. We do not sell or rent player information.</p>
      </section>

      <section id="device-features-and-permissions">
        <h2>Device features and permissions</h2>
        <p>The game may use on-device storage, haptic feedback, audio, clipboard, and the system share sheet. Clipboard and sharing actions occur only when you choose the relevant action. Version 1 does not need precise location, contacts, camera, microphone, photo library, advertising tracking, or background location permissions.</p>
      </section>

      <section id="children">
        <h2>Children</h2>
        <p>Hide &amp; Seek Cards is designed to minimize data and does not require contact information. Players should use a nickname rather than a real name. If you are a parent or guardian and believe a child supplied personal information that should be removed, contact us with enough information to investigate. We will delete information we can reasonably identify when required by applicable law.</p>
        <p>The app should not be treated as child-directed or listed in a “Made for Kids” category unless the operator has completed the additional legal, product, and store-policy review for that audience.</p>
      </section>

      <section id="security-and-international-processing">
        <h2>Security and international processing</h2>
        <p>We use encrypted network connections, signed session tokens, input validation, rate limits, access controls, and restricted infrastructure networks. No system is completely secure, so we cannot guarantee absolute security.</p>
        <p>The service may be hosted or supported outside your province, state, or country. Where required, we use appropriate safeguards for international processing. Local privacy rights may vary by location.</p>
      </section>

      <section id="your-choices-and-rights">
        <h2>Your choices and rights</h2>
        <p>Depending on where you live, you may have rights to ask about, access, correct, delete, or restrict the processing of personal information, appeal a response, object to certain processing, or complain to your local privacy authority.</p>
        <p>To make a request, email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. Include only the minimum information needed to understand the request. We may need to verify that a session or room belongs to you without asking you to create an account.</p>
      </section>

      <section id="changes-and-contact">
        <h2>Changes and contact</h2>
        <p>We may update this policy when the game, service providers, or legal requirements change. We will change the effective date and provide additional notice in the app or store listing when a change is material.</p>
        <address>Thoughtless Labs<br /><a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a></address>
      </section>
    </PublicPage>
  )
}

export function SupportPage() {
  return (
    <PublicPage
      eyebrow="Support"
      title="How can we help?"
      description="Quick fixes, useful details for bug reports, and ways to contact the Hide & Seek Cards team."
    >
      <section className="support-callout" aria-labelledby="support-contact-title">
        <h2 id="support-contact-title">Contact support</h2>
        <p>For gameplay, connection, accessibility, or purchase-free app questions, email us with a short description of what happened.</p>
        <a
          className="button button--primary support-email-button"
          href={`mailto:${SUPPORT_EMAIL}?subject=Hide%20%26%20Seek%20Cards%20support`}
          aria-label={`Email ${SUPPORT_EMAIL}`}
        >
          <span>Email support</span>
          <small>{SUPPORT_EMAIL}</small>
        </a>
      </section>

      <section>
        <h2>Try these quick fixes</h2>
        <ol>
          <li><strong>Reconnect:</strong> check that your device is online, then use the game’s Reconnect button.</li>
          <li><strong>Reopen the room:</strong> private invite codes are six characters and work only while that room is active.</li>
          <li><strong>Update the app:</strong> install the latest available version on every device joining the game.</li>
          <li><strong>Restart cleanly:</strong> close and reopen the app. If a local player card is causing trouble, use Reset local data in Settings.</li>
        </ol>
      </section>

      <section>
        <h2>What to include in a report</h2>
        <ul>
          <li>your app version, device model, and operating-system version;</li>
          <li>whether you were playing Solo Game, Quick Match, or a Private Room;</li>
          <li>the approximate date, time, and time zone of the issue;</li>
          <li>what you expected and what happened instead; and</li>
          <li>a screenshot if it does not reveal another person’s private information.</li>
        </ul>
        <p>Do not send passwords, full session tokens, signing keys, or other secrets. Hide &amp; Seek Cards does not use player passwords or paid accounts.</p>
      </section>

      <section>
        <h2>Privacy requests</h2>
        <p>For access, correction, deletion, or other privacy questions, email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> and read our <AppLink href="/privacy">Privacy Policy</AppLink>. Include only the minimum information needed to investigate.</p>
      </section>

      <section>
        <h2>Safety and availability</h2>
        <p>Support email is not an emergency service. If someone is in immediate danger, contact the appropriate local emergency service. Online multiplayer may occasionally be unavailable during maintenance or an incident; Solo Game remains available without the multiplayer service after the app has loaded.</p>
      </section>
    </PublicPage>
  )
}
