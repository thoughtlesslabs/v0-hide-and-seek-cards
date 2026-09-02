import { ArrowLeft, Ghost, Settings, Volume2, VolumeX } from "lucide-react"
import type { PlayerProfile } from "../lib/game-types"

interface AppHeaderProps {
  profile?: PlayerProfile
  eyebrow?: string
  onBack?: () => void
  onSettings?: () => void
  audioEnabled?: boolean
  onToggleAudio?: () => void
  compact?: boolean
}

export function AppHeader({ eyebrow, onBack, onSettings, audioEnabled, onToggleAudio, compact = false }: AppHeaderProps) {
  const hasQuickControls = Boolean(onSettings || onToggleAudio)
  return (
    <header className={`app-header ${compact ? "app-header--compact" : ""} ${hasQuickControls ? "app-header--controls" : ""}`}>
      <div className="app-header__side">
        {onBack && (
          <button className="icon-button" type="button" onClick={onBack} aria-label="Go back">
            <ArrowLeft aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="app-header__brand" aria-label="Hide and Seek Cards">
        <Ghost className="brand-spark" aria-hidden="true" />
        <span>
          <strong>Hide &amp; Seek</strong>
          <small>{eyebrow || "Cards"}</small>
        </span>
      </div>
      <div className="app-header__side app-header__side--end">
        {onToggleAudio && (
          <button
            className="icon-button app-header__audio"
            type="button"
            onClick={onToggleAudio}
            aria-label={audioEnabled ? "Mute all audio" : "Unmute all audio"}
            aria-pressed={!audioEnabled}
          >
            {audioEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          </button>
        )}
        {onSettings && (
          <button className="icon-button" type="button" onClick={onSettings} aria-label="Open settings">
            <Settings aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  )
}
