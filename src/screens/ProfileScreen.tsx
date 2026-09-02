import { useState, type FormEvent } from "react"
import { ArrowRight, Dices } from "lucide-react"
import { isValidDisplayName } from "../../shared/protocol"
import { AVATARS } from "../lib/avatars"
import type { AvatarId } from "../lib/game-types"
import { Avatar } from "../components/Avatar"

interface ProfileScreenProps {
  initialName?: string
  initialAvatar?: AvatarId
  editing?: boolean
  onSave: (displayName: string, avatarId: AvatarId) => void
  onCancel?: () => void
}

export function ProfileScreen({
  initialName = "",
  initialAvatar = "lyra",
  editing = false,
  onSave,
  onCancel,
}: ProfileScreenProps) {
  const [name, setName] = useState(initialName)
  const [avatarId, setAvatarId] = useState<AvatarId>(initialAvatar)
  const [nameTouched, setNameTouched] = useState(false)
  const cleanName = name.trim().replace(/\s+/g, " ")
  const nameValid = cleanName.length <= 18 && isValidDisplayName(cleanName)
  const showNameError = nameTouched && cleanName.length > 0 && !nameValid

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setNameTouched(true)
    if (!nameValid) return
    onSave(cleanName, avatarId)
  }

  return (
    <main className="screen profile-screen">
      <div className="ambient-orb ambient-orb--one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb--two" aria-hidden="true" />
      <section className="profile-card">
        <div className="brand-lockup">
          <span className="brand-lockup__sigil" aria-hidden="true"><Dices /></span>
          <p className="eyebrow">A silly little brush with doom</p>
          <h1>Hide &amp; Seek <span>Cards</span></h1>
          <p>{editing ? "Restyle your contestant." : "Choose who you’ll be on tonight’s haunted show."}</p>
        </div>

        <form onSubmit={handleSubmit} className="profile-form">
          <label className="field-label" htmlFor="player-name">Your player name</label>
          <input
            id="player-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 18))}
            onBlur={() => setNameTouched(true)}
            placeholder="Lucky Bones"
            autoComplete="nickname"
            enterKeyHint="done"
            required
            minLength={2}
            maxLength={18}
            aria-invalid={showNameError}
            aria-describedby={showNameError ? "player-name-error" : "player-name-help"}
            data-autofocus
          />
          {showNameError ? (
            <span className="field-error" id="player-name-error" role="alert">
              Start with a letter or number. Use letters, numbers, spaces, apostrophes, periods, dashes, underscores, or &amp;.
            </span>
          ) : (
            <span className="field-help" id="player-name-help">2–18 characters. Keep it party-friendly!</span>
          )}

          <fieldset className="avatar-fieldset">
            <legend>Choose a contestant</legend>
            <div className="avatar-grid">
              {AVATARS.map((avatar) => (
                <label key={avatar.id} className={`avatar-choice ${avatarId === avatar.id ? "avatar-choice--selected" : ""}`}>
                  <input
                    type="radio"
                    name="avatar"
                    value={avatar.id}
                    checked={avatarId === avatar.id}
                    onChange={() => setAvatarId(avatar.id)}
                  />
                  <Avatar avatarId={avatar.id} name={avatar.name} size="lg" />
                  <span>{avatar.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="profile-form__actions">
            {onCancel && (
              <button type="button" className="button button--ghost" onClick={onCancel}>Cancel</button>
            )}
            <button type="submit" className="button button--primary" disabled={!nameValid}>
              {editing ? "Save contestant" : "Join the show"} <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
