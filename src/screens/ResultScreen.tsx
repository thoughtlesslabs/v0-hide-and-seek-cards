import { Home, RefreshCw, Share2, Trophy } from "lucide-react"
import { Avatar } from "../components/Avatar"
import { ConnectionBanner } from "../components/ConnectionBanner"
import type { ConnectionStatus, GameClientError, GameSnapshot, PlayerProfile } from "../lib/game-types"
import { canShareText, shareText } from "../lib/platform"

interface ResultScreenProps {
  profile: PlayerProfile
  game: GameSnapshot
  connection: ConnectionStatus
  error?: GameClientError
  solo?: boolean
  rematchPending: boolean
  onRematch: () => void
  onHome: () => void
  onRetry: () => void
  onDismissError: () => void
}

export function ResultScreen({
  profile,
  game,
  connection,
  error,
  solo = false,
  rematchPending,
  onRematch,
  onHome,
  onRetry,
  onDismissError,
}: ResultScreenProps) {
  const winner = game.players.find((player) => player.id === game.winnerId) ?? game.players.find((player) => !player.isEliminated)
  const localWon = winner?.id === profile.id
  const votes = game.rematchVotes?.length ?? 0
  const humanPlayers = game.players.filter((player) => !player.isBot).length
  const canShare = canShareText()

  async function shareResult() {
    if (!winner) return
    await shareText("Hide & Seek Cards", `${winner.displayName} survived our Hide & Seek Cards game!`)
  }

  return (
    <main className="screen result-screen" data-player-count={game.players.length}>
      {!solo && <ConnectionBanner status={connection} error={error} onRetry={onRetry} onDismiss={onDismissError} compact />}
      <div className="result-stars" aria-hidden="true"><i /><i /><i /></div>
      <section className="result-card">
        <span className="result-card__trophy" aria-hidden="true"><Trophy /></span>
        <h1>{localWon ? "You survived the show!" : `${winner?.displayName || "A contestant"} survives!`}</h1>
        {winner && (
          <div className="winner-portrait">
            <Avatar avatarId={winner.avatarId} avatarUrl={winner.avatarUrl} name={winner.displayName} size="xl" priority />
          </div>
        )}

        <div className="result-scores" aria-label="Final scores">
          {game.players.map((player) => (
            <div key={player.id} className={player.id === winner?.id ? "result-score result-score--winner" : "result-score"}>
              <Avatar avatarId={player.avatarId} avatarUrl={player.avatarUrl} name={player.displayName} size="sm" />
              <span>
                <strong>{player.displayName}</strong>
                <small>{player.id === profile.id ? "You · " : ""}{player.roundWins} {player.roundWins === 1 ? "win" : "wins"}</small>
              </span>
            </div>
          ))}
        </div>

        <div className="result-actions">
          <button className="button button--primary" type="button" onClick={onRematch} disabled={rematchPending || (!solo && connection !== "connected")}>
          <RefreshCw aria-hidden="true" />{solo ? "Play again" : rematchPending ? "Vote sent" : "Play again"}
          </button>
          {!solo && humanPlayers > 1 && <p className="vote-status" role="status">{votes} of {humanPlayers} players want a rematch</p>}
          <div className="result-actions__row">
            {canShare && (
              <button className="button button--ghost" type="button" onClick={shareResult}><Share2 aria-hidden="true" />Share</button>
            )}
            <button className="button button--ghost" type="button" onClick={onHome}><Home aria-hidden="true" />Home</button>
          </div>
        </div>
      </section>
    </main>
  )
}
