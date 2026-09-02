import { useState, type FormEvent } from "react"
import { ArrowRight, KeyRound, Plus, Users } from "lucide-react"
import { AppHeader } from "../components/AppHeader"
import { ConnectionBanner } from "../components/ConnectionBanner"
import type { ConnectionStatus, GameClientError, MatchOptions } from "../lib/game-types"

interface PrivateRoomScreenProps {
  connection: ConnectionStatus
  error?: GameClientError
  pending: boolean
  initialCode?: string
  onCreate: (options: MatchOptions) => void
  onJoin: (code: string) => void
  onRetry: () => void
  onDismissError: () => void
  onBack: () => void
}

export function PrivateRoomScreen({ connection, error, pending, initialCode, onCreate, onJoin, onRetry, onDismissError, onBack }: PrivateRoomScreenProps) {
  const [inviteCode, setInviteCode] = useState(initialCode ?? "")
  const [maxPlayers, setMaxPlayers] = useState<4 | 8>(4)
  const [roundsToWin, setRoundsToWin] = useState<1 | 2 | 3>(2)

  function submitJoin(event: FormEvent) {
    event.preventDefault()
    if (inviteCode.length === 6) onJoin(inviteCode)
  }

  return (
    <main className="screen scroll-screen">
      <AppHeader eyebrow="Private Room" onBack={onBack} />
      <ConnectionBanner status={connection} error={error} onRetry={onRetry} onDismiss={onDismissError} />
      <section className="room-page">
        <header>
          <p className="eyebrow">Gather your favorite people</p>
          <h1>Play together, wherever you are</h1>
          <p>Create a room and share its code, or enter a friend’s code to join.</p>
        </header>

        <article className="room-card room-card--create">
          <div className="room-card__heading"><span><Plus aria-hidden="true" /></span><div><h2>Create a room</h2><p>You’ll be the host.</p></div></div>
          <fieldset className="choice-group">
            <legend>Table size</legend>
            <div className="segmented-control">
              {[4, 8].map((count) => (
                <label key={count}><input type="radio" name="players" checked={maxPlayers === count} onChange={() => setMaxPlayers(count as 4 | 8)} /><span><Users />{count} players</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset className="choice-group">
            <legend>Game length</legend>
            <div className="segmented-control segmented-control--three">
              {[
                { value: 1, label: "1 round" },
                { value: 2, label: "Best of 3" },
                { value: 3, label: "Best of 5" },
              ].map((option) => (
                <label key={option.value}><input type="radio" name="rounds" checked={roundsToWin === option.value} onChange={() => setRoundsToWin(option.value as 1 | 2 | 3)} /><span>{option.label}</span></label>
              ))}
            </div>
          </fieldset>
          <button className="button button--primary" type="button" disabled={pending} onClick={() => onCreate({ maxPlayers, roundsToWin })}>
            {pending ? "Creating…" : "Create room"}<ArrowRight aria-hidden="true" />
          </button>
        </article>

        <div className="room-divider"><span>or</span></div>

        <form className="room-card" onSubmit={submitJoin}>
          <div className="room-card__heading"><span><KeyRound aria-hidden="true" /></span><div><h2>Join with a code</h2><p>Ask the host for their room code.</p></div></div>
          <label className="field-label" htmlFor="invite-code">Room code</label>
          <input
            id="invite-code"
            className="text-input code-input"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6))}
            placeholder="GARDN2"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button className="button button--secondary" type="submit" disabled={pending || inviteCode.length !== 6}>
            {pending ? "Joining…" : "Join room"}<ArrowRight aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  )
}
