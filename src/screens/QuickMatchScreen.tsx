import { useState } from "react"
import { Search, Users } from "lucide-react"
import { AppHeader } from "../components/AppHeader"
import { ConnectionBanner } from "../components/ConnectionBanner"
import type { ConnectionStatus, GameClientError, MatchOptions } from "../lib/game-types"

interface QuickMatchScreenProps {
  connection: ConnectionStatus
  error?: GameClientError
  initialOptions: MatchOptions
  onStart: (options: MatchOptions) => void
  onRetry: () => void
  onDismissError: () => void
  onBack: () => void
}

const GAME_LENGTHS = [
  { value: 1, label: "1 round" },
  { value: 2, label: "Best of 3" },
  { value: 3, label: "Best of 5" },
] as const

export function QuickMatchScreen({
  connection,
  error,
  initialOptions,
  onStart,
  onRetry,
  onDismissError,
  onBack,
}: QuickMatchScreenProps) {
  const [maxPlayers, setMaxPlayers] = useState<4 | 8>(initialOptions.maxPlayers)
  const [roundsToWin, setRoundsToWin] = useState<1 | 2 | 3>(initialOptions.roundsToWin)
  const onlineUnavailable = connection !== "idle" && connection !== "connected"

  return (
    <main className="screen scroll-screen">
      <AppHeader eyebrow="Quick Match" onBack={onBack} />
      <ConnectionBanner status={connection} error={error} onRetry={onRetry} onDismiss={onDismissError} />
      <section className="room-page quick-match-page">
        <header>
          <p className="eyebrow">Choose your table</p>
          <h1>What kind of game?</h1>
          <p>We’ll find players who chose the same table size and game length.</p>
        </header>

        <article className="room-card quick-match-card">
          <fieldset className="choice-group">
            <legend>Table size</legend>
            <div className="segmented-control">
              {([4, 8] as const).map((count) => (
                <label key={count}>
                  <input
                    type="radio"
                    name="quick-players"
                    checked={maxPlayers === count}
                    onChange={() => setMaxPlayers(count)}
                  />
                  <span><Users aria-hidden="true" />{count} players</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="choice-group">
            <legend>Game length</legend>
            <div className="segmented-control segmented-control--three">
              {GAME_LENGTHS.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="quick-rounds"
                    checked={roundsToWin === option.value}
                    onChange={() => setRoundsToWin(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <p className="quick-match-card__summary">
            {maxPlayers}-player table · {roundsToWin === 1 ? "Single round" : `First to ${roundsToWin} wins`}
          </p>
          <button
            className="button button--primary"
            type="button"
            disabled={onlineUnavailable}
            onClick={() => onStart({ maxPlayers, roundsToWin })}
          >
            <Search aria-hidden="true" />Find a game
          </button>
        </article>
      </section>
    </main>
  )
}
