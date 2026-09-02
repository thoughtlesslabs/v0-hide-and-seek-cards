import { AlertTriangle, CloudOff, RefreshCw, WifiOff, X } from "lucide-react"
import type { ConnectionStatus, GameClientError } from "../lib/game-types"

interface ConnectionBannerProps {
  status: ConnectionStatus
  error?: GameClientError
  onRetry: () => void
  onDismiss?: () => void
  compact?: boolean
}

export function ConnectionBanner({ status, error, onRetry, onDismiss, compact = false }: ConnectionBannerProps) {
  if (!error && (status === "connected" || status === "idle")) return null
  const offline = status === "offline"
  const reconnecting = status === "connecting" || status === "reconnecting"
  const commandError = status === "connected" && Boolean(error)
  const message = offline
    ? "You're offline. Solo Game still works."
    : error?.message
      ? error.message
      : reconnecting
        ? status === "connecting"
          ? "Connecting to the game server…"
          : "Reconnecting to your game…"
        : "We couldn't connect to the game server."

  return (
    <aside className={`connection-banner ${compact ? "connection-banner--compact" : ""}`} role="status" aria-live="polite">
      {offline ? <WifiOff aria-hidden="true" /> : reconnecting ? <RefreshCw className="spin" aria-hidden="true" /> : commandError ? <AlertTriangle aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
      <span>{message}</span>
      {!reconnecting && !offline && error?.recoverable && (
        <button type="button" className="button button--tiny" onClick={onRetry}>
          Retry
        </button>
      )}
      {commandError && onDismiss && (
        <button type="button" className="icon-button connection-banner__dismiss" onClick={onDismiss} aria-label="Dismiss message">
          <X aria-hidden="true" />
        </button>
      )}
    </aside>
  )
}
