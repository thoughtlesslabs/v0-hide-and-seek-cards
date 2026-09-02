import { Crown, Skull } from "lucide-react"
import type { GamePlayerSnapshot } from "../lib/game-types"
import { Avatar } from "./Avatar"

interface PlayerChipProps {
  player: GamePlayerSnapshot
  selected: boolean
  active: boolean
  local: boolean
  candidate?: boolean
  selectable: boolean
  reaction?: string
  eliminating?: boolean
  selfEliminating?: boolean
  onSelect: (playerId: string) => void
}

export function PlayerChip({ player, selected, active, local, candidate = false, selectable, reaction, eliminating = false, selfEliminating = false, onSelect }: PlayerChipProps) {
  const stateText = player.isEliminated
    ? "out"
    : active
      ? "taking a turn"
      : selected
        ? "selected target"
        : `${player.roundWins} round wins`
  const activity = player.isEliminated ? "Out" : active ? "Seeker" : selected ? "Target" : undefined
  const identity = local ? "You" : player.isBot ? "Bot" : undefined
  const visibleState = [identity, activity].filter(Boolean).join(" · ") || "Ready"

  return (
    <button
      type="button"
      className={`player-chip ${local ? "player-chip--local" : ""} ${candidate ? "player-chip--candidate" : ""} ${selected ? "player-chip--selected" : ""} ${active ? "player-chip--active" : ""} ${player.isEliminated ? "player-chip--out" : ""} ${eliminating ? "player-chip--eliminating" : ""}`}
      disabled={!selectable}
      aria-pressed={selectable ? selected : undefined}
      aria-label={`${player.displayName}${local ? ", you" : ""}, ${stateText}`}
      data-player-id={player.id}
      onClick={() => onSelect(player.id)}
    >
      {reaction && <span className="player-chip__reaction" aria-label={`${player.displayName} reacted ${reaction}`}>{reaction}</span>}
      {eliminating && (
        <span className="player-chip__death-burst" aria-hidden="true">
          <i>☠</i>
          <b>{selfEliminating ? "TRAP!" : "GOT 'EM!"}</b>
        </span>
      )}
      <span className="player-chip__avatar">
        <Avatar avatarId={player.avatarId} avatarUrl={player.avatarUrl} name={player.displayName} size="md" />
        {player.isEliminated && (
          <span className="player-chip__out-mark" aria-hidden="true">
            <Skull />
          </span>
        )}
      </span>
      <span className="player-chip__copy">
        <strong>{player.displayName}</strong>
        <small>{visibleState}</small>
      </span>
      {player.roundWins > 0 && (
        <span className="player-chip__wins" aria-label={`${player.roundWins} round wins`}>
          <Crown aria-hidden="true" /> {player.roundWins}
        </span>
      )}
    </button>
  )
}
