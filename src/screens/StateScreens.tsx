import { CloudOff, Dices, RefreshCw, SearchX } from "lucide-react"
import { AppHeader } from "../components/AppHeader"

export function LoadingScreen({
  label = "Raising the curtain on the haunted show…",
  onCancel,
}: {
  label?: string
  onCancel?: () => void
}) {
  return (
    <main className="screen state-screen" aria-busy="true">
      <span className="loading-sigil" aria-hidden="true"><Dices /></span>
      <p role="status">{label}</p>
      {onCancel && <button className="button button--ghost" type="button" onClick={onCancel}>Cancel</button>}
    </main>
  )
}

export function EmptyStateScreen({
  title,
  message,
  onRetry,
  onHome,
}: {
  title: string
  message: string
  onRetry?: () => void
  onHome: () => void
}) {
  return (
    <main className="screen scroll-screen state-screen-shell">
      <AppHeader onBack={onHome} />
      <section className="state-screen state-screen--card">
        <span className="state-screen__icon" aria-hidden="true"><SearchX /></span>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="state-screen__actions">
          {onRetry && <button className="button button--primary" type="button" onClick={onRetry}><RefreshCw />Try again</button>}
          <button className="button button--ghost" type="button" onClick={onHome}>Back home</button>
        </div>
      </section>
    </main>
  )
}

export function FatalConnectionScreen({ onRetry, onSolo, onHome }: { onRetry: () => void; onSolo: () => void; onHome: () => void }) {
  return (
    <main className="screen scroll-screen state-screen-shell">
      <section className="state-screen state-screen--card">
        <span className="state-screen__icon" aria-hidden="true"><CloudOff /></span>
        <h1>The ghost signal went out</h1>
        <p>We couldn’t reach the multiplayer show. Your contestant is safe, and Solo Game still works.</p>
        <div className="state-screen__actions">
          <button className="button button--primary" type="button" onClick={onRetry}><RefreshCw />Reconnect</button>
          <button className="button button--secondary" type="button" onClick={onSolo}>Play solo</button>
          <button className="button button--ghost" type="button" onClick={onHome}>Back home</button>
        </div>
      </section>
    </main>
  )
}
