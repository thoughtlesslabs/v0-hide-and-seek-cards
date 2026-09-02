import { useState, type CSSProperties } from "react"
import { Skull } from "lucide-react"
import type { GameCardSnapshot, GamePlayerSnapshot } from "../lib/game-types"
import { getAvatar } from "../lib/avatars"

interface GameCardProps {
  card: GameCardSnapshot
  index: number
  total: number
  revealedOwner?: GamePlayerSnapshot
  canPick: boolean
  pending: boolean
  onPick: (cardId: string) => void
}

export function GameCard({ card, index, total, revealedOwner, canPick, pending, onPick }: GameCardProps) {
  const [artFailed, setArtFailed] = useState(false)
  const [failedPortraitSource, setFailedPortraitSource] = useState<string>()
  const revealedAvatar = revealedOwner ? getAvatar(revealedOwner.avatarId) : undefined
  const portraitSource = revealedOwner?.avatarUrl?.startsWith("/")
    ? revealedOwner.avatarUrl
    : revealedAvatar?.imagePath
  const portraitFailed = failedPortraitSource === portraitSource

  const label = card.isRevealed && revealedOwner
    ? `Hiding place ${index + 1} reveals ${revealedOwner.displayName}`
    : canPick
      ? `Choose hiding place ${index + 1} of ${total}`
      : `Hidden card ${index + 1} of ${total}`

  return (
    <button
      type="button"
      className={`game-card ${card.isRevealed ? "game-card--revealed" : ""} ${canPick ? "game-card--pickable" : ""}`}
      disabled={!canPick || pending || card.isRevealed}
      aria-label={label}
      data-card-id={card.id}
      onClick={() => onPick(card.id)}
      style={{ "--card-order": index } as CSSProperties}
    >
      <span className="game-card__inner">
        <span className="game-card__face game-card__back" aria-hidden="true">
          <span className="game-card__art-fallback">
            <i />
            <Skull />
          </span>
          {!artFailed && (
            <img
              src="/assets/card-back-party.webp"
              alt=""
              draggable={false}
              onError={() => setArtFailed(true)}
            />
          )}
          <span className="game-card__number">{index + 1}</span>
        </span>
        <span className="game-card__face game-card__front" aria-hidden="true">
          {revealedOwner && revealedAvatar ? (
            <>
              <span
                className="game-card__portrait"
                style={{
                  "--portrait-a": revealedAvatar.colors[0],
                  "--portrait-b": revealedAvatar.colors[1],
                  "--portrait-focus": revealedAvatar.focus,
                } as CSSProperties}
              >
                <span className="game-card__portrait-fallback">
                  {revealedAvatar.glyph || revealedOwner.displayName.slice(0, 1).toUpperCase()}
                </span>
                {portraitSource && !portraitFailed && (
                  <img
                    src={portraitSource}
                    alt=""
                    loading="eager"
                    decoding="async"
                    draggable={false}
                    onError={() => setFailedPortraitSource(portraitSource)}
                  />
                )}
              </span>
              <span className="game-card__reveal-copy">
                <strong>{revealedOwner.displayName}</strong>
                <small>was hiding here</small>
              </span>
            </>
          ) : (
            <Skull />
          )}
        </span>
      </span>
    </button>
  )
}
