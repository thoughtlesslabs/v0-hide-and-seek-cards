import { useMemo, useState } from "react"
import { Flag, MessageCircle, Skull } from "lucide-react"
import { AppHeader } from "../components/AppHeader"
import { ConnectionBanner } from "../components/ConnectionBanner"
import { GameCard } from "../components/GameCard"
import { PlayerChip } from "../components/PlayerChip"
import { TurnTimer } from "../components/TurnTimer"
import type { ConnectionStatus, GameClientError, GameSnapshot, PlayerProfile } from "../lib/game-types"

const REACTIONS = ["👍", "😄", "😮", "👏"] as const

function firstSentence(message: string) {
  const ending = message.search(/[.!?]/)
  return ending >= 0 ? message.slice(0, ending + 1) : message
}

interface GameScreenProps {
  profile: PlayerProfile
  game: GameSnapshot
  connection: ConnectionStatus
  error?: GameClientError
  solo?: boolean
  onSelectTarget: (targetPlayerId: string) => Promise<boolean>
  onPickCard: (cardId: string, targetPlayerId: string) => Promise<boolean>
  onReaction?: (emoji: string) => void
  onRetry: () => void
  onDismissError: () => void
  onLeave: () => void
}

export function GameScreen({
  profile,
  game,
  connection,
  error,
  solo = false,
  onSelectTarget,
  onPickCard,
  onReaction,
  onRetry,
  onDismissError,
  onLeave,
}: GameScreenProps) {
  const [optimisticTarget, setOptimisticTarget] = useState<{ id: string; version: number }>()
  const [pendingVersion, setPendingVersion] = useState<number>()
  const localPlayer = game.players.find((player) => player.id === profile.id)
  const currentPlayer = game.players.find((player) => player.id === game.currentPlayerId)
  const isLocalTurn = game.currentPlayerId === profile.id && !localPlayer?.isEliminated && game.canAct !== false
  const selectedTargetId = optimisticTarget?.version === game.version ? optimisticTarget.id : undefined
  const targetId = game.targetPlayerId || selectedTargetId
  const pendingAction = pendingVersion === game.version
  const canChooseTarget = isLocalTurn && game.phase === "select_target" && !pendingAction
  const canChooseCard = isLocalTurn && game.phase === "select_card" && Boolean(targetId) && !pendingAction
  const targetPlayer = game.players.find((player) => player.id === targetId)
  const eliminationPlayerId = game.pendingEliminationId
  const selfElimination = game.lastEvent?.kind === "self_found"
  const showTimer = isLocalTurn && (game.phase === "select_target" || game.phase === "select_card")

  const sortedCards = useMemo(() => [...game.cards].sort((a, b) => a.position - b.position), [game.cards])
  const revealedPlayerName = game.players.find((player) =>
    sortedCards.some((card) => card.isRevealed && card.revealedOwnerId === player.id),
  )?.displayName
  const cardCapacity = Math.min(game.players.length, 8)
  const emptyCardSlots = Math.max(0, cardCapacity - sortedCards.length)
  const instruction = useMemo(() => {
    if (game.phase === "starting") return { eyebrow: "Get ready", title: "The deck is waking up" }
    if (game.phase === "revealing") {
      if (selfElimination) {
        return { eyebrow: "Trapdoor!", title: `${revealedPlayerName || "A contestant"} found their own card!` }
      }
      if (game.lastEvent?.kind === "found") {
        return { eyebrow: "Caught!", title: `${revealedPlayerName || "A contestant"} was hiding here!` }
      }
      return { eyebrow: "Revealed", title: revealedPlayerName ? `${revealedPlayerName} was hiding here` : "A card was revealed" }
    }
    if (game.phase === "shuffling") return { eyebrow: "New hiding places", title: "Every card moved" }
    if (game.phase === "eliminating") return { eyebrow: selfElimination ? "Trapdoor!" : "Eliminated!", title: firstSentence(game.message) }
    if (game.phase === "round_end") return { eyebrow: "Round complete", title: firstSentence(game.message) }
    if (!isLocalTurn && game.phase === "select_target") {
      return { eyebrow: `${currentPlayer?.displayName || "Another player"}’s turn`, title: "Choosing a player…" }
    }
    if (!isLocalTurn) {
      return {
        eyebrow: targetPlayer ? `Seeking ${targetPlayer.displayName}` : `${currentPlayer?.displayName || "Another player"}’s turn`,
        title: "Choosing a card…",
      }
    }
    if (game.phase === "select_target") return { eyebrow: "Your turn", title: "Choose a player" }
    return { eyebrow: "Your turn", title: "Choose a card" }
  }, [currentPlayer?.displayName, game.lastEvent?.kind, game.message, game.phase, isLocalTurn, revealedPlayerName, selfElimination, targetPlayer])

  const deckTitle = game.phase === "select_target"
    ? "Cards waiting for a target"
    : game.phase === "select_card"
    ? targetPlayer
      ? `Find ${targetPlayer.displayName}`
      : "Choose a card"
    : game.phase === "revealing"
      ? "Revealed"
      : game.phase === "shuffling"
        ? "Cards moving"
        : game.phase === "eliminating"
          ? "Survivors reshuffled"
          : "The haunted deck"

  async function chooseTarget(playerId: string) {
    if (!canChooseTarget) return
    setOptimisticTarget({ id: playerId, version: game.version })
    setPendingVersion(game.version)
    const accepted = await onSelectTarget(playerId)
    if (!accepted) {
      setOptimisticTarget(undefined)
      setPendingVersion(undefined)
    }
  }

  async function chooseCard(cardId: string) {
    if (!canChooseCard || !targetId) return
    setPendingVersion(game.version)
    const accepted = await onPickCard(cardId, targetId)
    if (!accepted) setPendingVersion(undefined)
  }

  return (
    <main
      className={`screen game-screen game-screen--${game.phase}`}
      data-player-count={game.players.length}
    >
      <AppHeader
        eyebrow={solo ? (game.roundsToWin > 1 ? `Solo · Round ${game.round}` : "Solo Game") : `Round ${game.round}`}
        onBack={onLeave}
        compact
      />
      {!solo && <ConnectionBanner status={connection} error={error} onRetry={onRetry} onDismiss={onDismissError} compact />}

      <section className="turn-panel" aria-labelledby="turn-title">
        <div className="turn-panel__copy">
          <p className="eyebrow">{instruction.eyebrow}</p>
          <h1 id="turn-title">{instruction.title}</h1>
          {game.roundsToWin > 1 && (
            <span className="turn-panel__round">Round {game.round} · First to {game.roundsToWin}</span>
          )}
        </div>
        <div className={`turn-panel__timer-slot ${showTimer ? "" : "turn-panel__timer-slot--empty"}`}>
          {showTimer && <TurnTimer deadline={game.turnDeadlineAt} durationMs={game.turnDurationMs} />}
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{game.message}</p>
      </section>

      <section
        className={`player-roster player-roster--seated ${!isLocalTurn ? "player-roster--watching" : ""}`}
        aria-label="Players at the table"
        data-player-count={game.players.length}
      >
        {game.players.map((player) => (
          <PlayerChip
            key={player.id}
            player={player}
            local={player.id === profile.id}
            active={player.id === game.currentPlayerId}
            selected={player.id === targetId}
            candidate={isLocalTurn && game.phase === "select_target" && player.id !== profile.id && !player.isEliminated}
            selectable={canChooseTarget && player.id !== profile.id && !player.isEliminated}
            eliminating={player.id === eliminationPlayerId && (game.phase === "revealing" || game.phase === "eliminating")}
            selfEliminating={player.id === eliminationPlayerId && selfElimination}
            reaction={game.reactions?.find((reaction) => reaction.playerId === player.id && reaction.expiresAt > Date.now())?.emoji}
            onSelect={chooseTarget}
          />
        ))}
      </section>

      <section
        className={`card-table ${game.phase === "select_target" ? "card-table--waiting" : ""} ${game.phase === "revealing" ? "card-table--spotlight" : ""} ${game.phase === "shuffling" || game.phase === "eliminating" ? "card-table--moving" : ""} ${game.phase === "round_end" ? "card-table--resting" : ""}`}
        aria-labelledby="cards-title"
      >
        <h2 className="sr-only" id="cards-title">{deckTitle}</h2>
        {sortedCards.length > 0 ? (
          <div
            className={`card-grid card-grid--${cardCapacity}`}
            aria-hidden={game.phase === "select_target" || game.phase === "starting" ? true : undefined}
          >
            {sortedCards.map((card, index) => {
              const owner = card.revealedOwnerId
                ? game.players.find((player) => player.id === card.revealedOwnerId)
                : undefined
              return (
                <GameCard
                  key={card.id}
                  card={card}
                  index={index}
                  total={sortedCards.length}
                  revealedOwner={owner}
                  canPick={canChooseCard}
                  pending={pendingAction}
                  onPick={chooseCard}
                />
              )
            })}
            {Array.from({ length: emptyCardSlots }, (_, index) => (
              <div className="card-slot card-slot--empty" aria-hidden="true" data-empty-card-slot key={`empty-card-slot-${index}`} />
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--compact" role="status">
            <Flag aria-hidden="true" /><strong>No cards are available</strong><p>Waiting for the next round to begin.</p>
          </div>
        )}
      </section>

      {onReaction && (
        <footer className="game-toolbar game-toolbar--reactions" aria-label="Send a reaction">
          <span className="reaction-strip__label"><MessageCircle aria-hidden="true" /><span>React</span></span>
          <div className="reaction-strip">
            {REACTIONS.map((emoji) => (
              <button
                type="button"
                className="reaction-strip__button"
                key={emoji}
                aria-label={`Send ${emoji} reaction`}
                onClick={() => onReaction(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </footer>
      )}

      {game.phase === "starting" && (
        <div className="game-start-overlay" role="status" aria-live="assertive">
          <Skull size={88} strokeWidth={1.6} aria-hidden="true" />
          <p>Choose. Reveal.<br />Survive.</p>
        </div>
      )}
    </main>
  )
}
