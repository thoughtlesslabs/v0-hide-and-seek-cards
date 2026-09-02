import { useDeadline } from "../hooks/use-deadline"

interface TurnTimerProps {
  deadline?: number
  durationMs?: number
  urgent?: boolean
}

export function TurnTimer({ deadline, durationMs = 15_000, urgent = false }: TurnTimerProps) {
  const { seconds, progress } = useDeadline(deadline, durationMs)
  if (!deadline) return null

  return (
    <div className={`turn-timer ${seconds <= 5 || urgent ? "turn-timer--urgent" : ""}`} aria-label={`${seconds} seconds remaining`}>
      <span aria-hidden="true">{seconds}</span>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="turn-timer__track" cx="22" cy="22" r="18" />
        <circle
          className="turn-timer__progress"
          cx="22"
          cy="22"
          r="18"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - progress * 100}
        />
      </svg>
    </div>
  )
}
