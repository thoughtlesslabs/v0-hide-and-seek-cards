import { Contrast, Ghost, LifeBuoy, Music2, Pencil, ShieldCheck, Smartphone, Trash2, Volume1, Volume2 } from "lucide-react"
import { useState, type ReactNode } from "react"
import { AppHeader } from "../components/AppHeader"
import { AppLink } from "../components/AppLink"
import { Avatar } from "../components/Avatar"
import { Dialog } from "../components/Dialog"
import type { AppPreferences, MotionPreference, PlayerProfile } from "../lib/game-types"

interface SettingsScreenProps {
  profile: PlayerProfile
  preferences: AppPreferences
  onChange: (preferences: AppPreferences) => void
  onEditProfile: () => void
  onResetLocalData: () => Promise<boolean>
  onBack: () => void
}

export function SettingsScreen({ profile, preferences, onChange, onEditProfile, onResetLocalData, onBack }: SettingsScreenProps) {
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [resetFailed, setResetFailed] = useState(false)

  function toggle(key: "audioEnabled" | "soundEnabled" | "musicEnabled" | "hapticsEnabled" | "highContrast") {
    onChange({ ...preferences, [key]: !preferences[key] })
  }

  async function confirmReset() {
    setResetPending(true)
    setResetFailed(false)
    const cleared = await onResetLocalData().catch(() => false)
    if (!cleared) {
      setResetPending(false)
      setResetFailed(true)
    }
  }

  function closeReset() {
    if (resetPending) return
    setResetOpen(false)
    setResetFailed(false)
  }

  return (
    <main className="screen scroll-screen">
      <AppHeader eyebrow="Settings" onBack={onBack} />
      <section className="settings-page">
        <button type="button" className="settings-profile" onClick={onEditProfile}>
          <Avatar avatarId={profile.avatarId} name={profile.displayName} size="lg" />
          <span><small>Player card</small><strong>{profile.displayName}</strong></span>
          <Pencil aria-hidden="true" />
        </button>

        <div className="settings-group">
          <h1>Play your way</h1>
          <SettingToggle
            icon={<Volume2 />}
            label="All audio"
            description="Master switch for music and sound effects"
            checked={preferences.audioEnabled}
            onChange={() => toggle("audioEnabled")}
          />
          <SettingToggle
            icon={<Music2 />}
            label="Music"
            description="Scene themes and panic-mode mixes"
            checked={preferences.musicEnabled}
            onChange={() => toggle("musicEnabled")}
            disabled={!preferences.audioEnabled}
          />
          <SettingRange
            icon={<Music2 />}
            label="Music volume"
            value={preferences.musicVolume}
            disabled={!preferences.audioEnabled || !preferences.musicEnabled}
            onChange={(musicVolume) => onChange({ ...preferences, musicVolume })}
          />
          <SettingToggle
            icon={<Volume2 />}
            label="Sound effects"
            description="Card flips and turn chimes"
            checked={preferences.soundEnabled}
            onChange={() => toggle("soundEnabled")}
            disabled={!preferences.audioEnabled}
          />
          <SettingRange
            icon={<Volume1 />}
            label="Effects volume"
            value={preferences.effectsVolume}
            disabled={!preferences.audioEnabled || !preferences.soundEnabled}
            onChange={(effectsVolume) => onChange({ ...preferences, effectsVolume })}
          />
          <SettingToggle
            icon={<Smartphone />}
            label="Haptic feedback"
            description="Gentle taps on supported devices"
            checked={preferences.hapticsEnabled}
            onChange={() => toggle("hapticsEnabled")}
          />
          <label className="setting-row">
            <span className="setting-row__icon"><Ghost aria-hidden="true" /></span>
            <span className="setting-row__copy"><strong>Motion</strong><small>Control flips and spooky effects</small></span>
            <select
              value={preferences.motion}
              onChange={(event) => onChange({ ...preferences, motion: event.target.value as MotionPreference })}
              aria-label="Motion preference"
            >
              <option value="system">Follow device</option>
              <option value="full">Full motion</option>
              <option value="reduced">Reduced</option>
            </select>
          </label>
          <SettingToggle
            icon={<Contrast />}
            label="Extra contrast"
            description="Stronger text and card outlines"
            checked={preferences.highContrast}
            onChange={() => toggle("highContrast")}
          />
        </div>

        <section className="settings-about">
          <h2>About this game</h2>
          <p>Hide &amp; Seek Cards is a family guessing game. Preferences stay on this device; during online play, your player name and chosen contestant are shared with the other players and game server.</p>
          <nav className="settings-links" aria-label="Legal and support">
            <AppLink href="/privacy"><ShieldCheck aria-hidden="true" />Privacy Policy</AppLink>
            <AppLink href="/support"><LifeBuoy aria-hidden="true" />Support</AppLink>
          </nav>
          <p className="settings-version">Version 1.0.0</p>
        </section>

        <section className="settings-data">
          <h2>Your local data</h2>
          <p>Remove this player card, app preferences, and the anonymous multiplayer session from this device.</p>
          <button className="button button--danger" type="button" onClick={() => setResetOpen(true)}>
            <Trash2 aria-hidden="true" />Reset local data
          </button>
        </section>
      </section>

      <Dialog
        open={resetOpen}
        title="Reset local data?"
        description="This removes your player card, preferences, and anonymous session from this device. You’ll return to player setup."
        onClose={closeReset}
        closeLabel="Cancel local data reset"
      >
        {resetFailed && <p className="dialog-error" role="alert">The device did not allow the app to clear its storage. Try the browser or operating-system storage controls instead.</p>}
        <div className="dialog-actions">
          <button className="button button--ghost" type="button" onClick={closeReset} disabled={resetPending} data-autofocus>Cancel</button>
          <button className="button button--danger" type="button" onClick={confirmReset} disabled={resetPending} aria-busy={resetPending}>
            <Trash2 aria-hidden="true" />{resetPending ? "Resetting…" : "Reset data"}
          </button>
        </div>
      </Dialog>
    </main>
  )
}

function SettingRange({
  icon,
  label,
  value,
  disabled,
  onChange,
}: {
  icon: ReactNode
  label: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const percent = Math.round(value * 100)
  return (
    <label className={`setting-row setting-row--range ${disabled ? "setting-row--disabled" : ""}`}>
      <span className="setting-row__icon" aria-hidden="true">{icon}</span>
      <span className="setting-row__copy"><strong>{label}</strong><small>{percent}%</small></span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={percent}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
    </label>
  )
}

function SettingToggle({
  icon,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: ReactNode
  label: string
  description: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <label className={`setting-row ${disabled ? "setting-row--disabled" : ""}`}>
      <span className="setting-row__icon" aria-hidden="true">{icon}</span>
      <span className="setting-row__copy"><strong>{label}</strong><small>{description}</small></span>
      <input className="switch" type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  )
}
