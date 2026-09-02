import { useEffect, useState } from "react"
import { Check, Clock3, Copy, Ghost, LogOut, Play, Share2, Users } from "lucide-react"
import { AppHeader } from "../components/AppHeader"
import { Avatar } from "../components/Avatar"
import { ConnectionBanner } from "../components/ConnectionBanner"
import type { ConnectionStatus, GameClientError, LobbySnapshot, PlayerProfile } from "../lib/game-types"
import { copyText, shareText } from "../lib/platform"
import { roomInviteUrl } from "../lib/invite-link"

interface LobbyScreenProps {
  profile: PlayerProfile
  lobby: LobbySnapshot
  connection: ConnectionStatus
  error?: GameClientError
  pending: boolean
  onStart: () => void
  onLeave: () => void
  onRetry: () => void
  onDismissError: () => void
}

export function LobbyScreen({ profile, lobby, connection, error, pending, onStart, onLeave, onRetry, onDismissError }: LobbyScreenProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")
  const [now, setNow] = useState(() => Date.now())
  const isHost = lobby.hostId === profile.id
  // The server remains the authority for starting. Do not strand a host because
  // a reconnect briefly left the optional presentation hint out of date.
  const canStart = isHost && connection === "connected" && lobby.status === "waiting"
  const secondsToStart = lobby.startsAt ? Math.max(0, Math.ceil((lobby.startsAt - now) / 1_000)) : undefined

  useEffect(() => {
    if (!lobby.startsAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [lobby.startsAt])

  async function copyCode() {
    if (!lobby.inviteCode) return
    try {
      await copyText(lobby.inviteCode)
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }
    window.setTimeout(() => setCopyState("idle"), 2_000)
  }

  async function shareRoom() {
    if (!lobby.inviteCode) return
    const inviteUrl = roomInviteUrl(lobby.inviteCode)
    const text = `Join my Hide & Seek Cards room: ${inviteUrl}\nRoom code: ${lobby.inviteCode}`
    const result = await shareText("Hide & Seek Cards", text)
    if (result !== "unavailable") return
    try {
      await copyText(inviteUrl)
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }
    window.setTimeout(() => setCopyState("idle"), 2_000)
  }

  return (
    <main className="screen scroll-screen lobby-screen">
      <AppHeader profile={profile} eyebrow={lobby.mode === "private" ? "Private Room" : "Quick Match"} />
      <ConnectionBanner status={connection} error={error} onRetry={onRetry} onDismiss={onDismissError} />
      <section className="lobby-page">
        <header className="lobby-heading">
        <span className="lobby-heading__icon" aria-hidden="true"><Ghost /></span>
        <p className="eyebrow">{lobby.status === "starting" ? "The trapdoor is opening" : "The cast is almost ready"}</p>
        <h1>{lobby.mode === "private" ? "Waiting for brave friends" : "Casting fellow contestants"}</h1>
          <p>
            {lobby.mode === "private"
              ? isHost ? "Share the code, then start when everyone arrives." : "The host will begin when everyone is ready."
            : "We’ll start when the cast fills or add cheeky house bots after a short wait."}
          </p>
        </header>

        {lobby.inviteCode && (
          <section className="invite-card" aria-labelledby="invite-title">
            <div><small id="invite-title">Room code</small><strong aria-label={`Room code ${lobby.inviteCode.split("").join(" ")}`}>{lobby.inviteCode}</strong></div>
            <div className="invite-card__actions">
              <button className="icon-button icon-button--label" type="button" onClick={copyCode} aria-label="Copy room code">
                {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}<span>{copyState === "copied" ? "Copied" : "Copy"}</span>
              </button>
              <button className="icon-button icon-button--label" type="button" onClick={shareRoom} aria-label="Share room invitation">
                <Share2 aria-hidden="true" /><span>Share</span>
              </button>
            </div>
            <span className="sr-only" aria-live="polite">{copyState === "copied" ? "Invitation copied" : copyState === "failed" ? "Couldn't copy the invitation" : ""}</span>
          </section>
        )}

        <section className="lobby-table" aria-labelledby="players-heading">
          <div className="lobby-table__header">
            <div><Users aria-hidden="true" /><h2 id="players-heading">Players</h2></div>
            <span>{lobby.players.length} / {lobby.maxPlayers}</span>
          </div>
          <div className="lobby-players">
            {lobby.players.map((player) => (
              <article className="lobby-player" key={player.id}>
                <Avatar avatarId={player.avatarId} avatarUrl={player.avatarUrl} name={player.displayName} size="lg" />
              <div><strong>{player.id === profile.id ? "You" : player.displayName}</strong><small>{player.isHost ? "Host" : player.isBot ? "House bot" : "Ready"}</small></div>
                <span className="ready-dot"><Check aria-label="Ready" /></span>
              </article>
            ))}
            {Array.from({ length: Math.max(0, lobby.maxPlayers - lobby.players.length) }, (_, index) => (
              <article className="lobby-player lobby-player--empty" key={`open-${index}`}>
                <span className="empty-avatar" aria-hidden="true">?</span>
              <div><strong>Empty chair</strong><small>Something may sit here…</small></div>
              </article>
            ))}
          </div>
        </section>

        <div className="lobby-meta">
          <span><Clock3 aria-hidden="true" />{lobby.roundsToWin === 1 ? "Single round" : `First to ${lobby.roundsToWin} wins`}</span>
          {secondsToStart !== undefined && <strong>{secondsToStart > 0 ? `Starts in ${secondsToStart}s` : "Starting…"}</strong>}
        </div>

        <div className="sticky-actions">
          {isHost && (
            <button className="button button--primary" type="button" onClick={onStart} disabled={!canStart || pending} aria-busy={pending}>
            <Play aria-hidden="true" />{pending ? "Starting…" : lobby.players.length < 2 ? "Invite house bots" : "Start the show"}
            </button>
          )}
        {!isHost && lobby.mode === "private" && <p className="waiting-note" role="status"><span className="pulse-dot" />Waiting for the host to pull the lever…</p>}
          <button className="button button--ghost" type="button" onClick={onLeave} disabled={pending}>
            <LogOut aria-hidden="true" />Leave room
          </button>
        </div>
      </section>
    </main>
  )
}
