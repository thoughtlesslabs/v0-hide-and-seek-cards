import { BookOpen, Bot, DoorOpen, GraduationCap, Trophy, Users } from "lucide-react"
import { AppHeader } from "../components/AppHeader"
import { Avatar } from "../components/Avatar"
import { ConnectionBanner } from "../components/ConnectionBanner"
import type { ConnectionStatus, GameClientError, PlayerProfile } from "../lib/game-types"

interface HomeScreenProps {
  profile: PlayerProfile
  connection: ConnectionStatus
  error?: GameClientError
  onQuickMatch: () => void
  onPrivateRoom: () => void
  onSolo: () => void
  onHowToPlay: () => void
  onTutorial: () => void
  onAchievements: () => void
  onSettings: () => void
  audioEnabled: boolean
  onToggleAudio: () => void
  onRetry: () => void
  onDismissError: () => void
}

export function HomeScreen({
  profile,
  connection,
  error,
  onQuickMatch,
  onPrivateRoom,
  onSolo,
  onHowToPlay,
  onTutorial,
  onAchievements,
  onSettings,
  audioEnabled,
  onToggleAudio,
  onRetry,
  onDismissError,
}: HomeScreenProps) {
  const onlineUnavailable = connection !== "idle" && connection !== "connected"
  const onlineLabel =
    connection === "connecting" || connection === "reconnecting"
      ? "Connecting to online play…"
      : onlineUnavailable
        ? "Online play unavailable"
        : "Meet players and start fast"

  return (
    <main className="screen home-screen">
      <AppHeader
        profile={profile}
        onSettings={onSettings}
        audioEnabled={audioEnabled}
        onToggleAudio={onToggleAudio}
      />
      <ConnectionBanner status={connection} error={error} onRetry={onRetry} onDismiss={onDismissError} />

      <section className="home-hero">
        <div className="home-hero__avatar">
          <Avatar avatarId={profile.avatarId} name={profile.displayName} size="xl" priority />
        </div>
        <div>
          <p className="eyebrow">Welcome back, contestant</p>
          <h1>{profile.displayName}</h1>
          <p>Pick a player. Flip a card. Survive the shuffle.</p>
        </div>
      </section>

      <section className="home-actions" aria-label="Play options">
        <button className="play-tile play-tile--primary" type="button" onClick={onQuickMatch} disabled={onlineUnavailable}>
          <span className="play-tile__icon"><Users aria-hidden="true" /></span>
          <span><strong>Quick Match</strong><small>{onlineLabel}</small></span>
          <span className="play-tile__arrow" aria-hidden="true">→</span>
        </button>
        <button className="play-tile" type="button" onClick={onPrivateRoom} disabled={onlineUnavailable}>
          <span className="play-tile__icon"><DoorOpen aria-hidden="true" /></span>
          <span><strong>Private Room</strong><small>Play with family and friends</small></span>
          <span className="play-tile__arrow" aria-hidden="true">→</span>
        </button>
        <button className="play-tile" type="button" onClick={onSolo}>
          <span className="play-tile__icon"><Bot aria-hidden="true" /></span>
          <span><strong>Solo Game</strong><small>Play a full game against lively bots</small></span>
          <span className="play-tile__arrow" aria-hidden="true">→</span>
        </button>
      </section>

      <nav className="home-secondary home-secondary--three" aria-label="More options">
        <button type="button" onClick={onTutorial}><GraduationCap aria-hidden="true" />Play Tutorial</button>
        <button type="button" onClick={onHowToPlay}><BookOpen aria-hidden="true" />How to Play</button>
        <button type="button" onClick={onAchievements}><Trophy aria-hidden="true" />Achievements</button>
      </nav>

      <p className="home-footnote">Cartoon peril for game night — no account needed.</p>
    </main>
  )
}
