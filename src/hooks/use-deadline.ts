import { useEffect, useMemo, useState } from "react"

export function useDeadline(deadline: number | undefined, durationMs: number) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!deadline) return
    const update = () => setNow(Date.now())
    const immediate = window.setTimeout(update, 0)
    const interval = window.setInterval(update, 200)
    return () => {
      window.clearTimeout(immediate)
      window.clearInterval(interval)
    }
  }, [deadline])

  return useMemo(() => {
    if (!deadline) return { seconds: 0, progress: 0 }
    const remaining = Math.max(0, deadline - now)
    return {
      seconds: Math.ceil(remaining / 1_000),
      progress: Math.min(1, remaining / Math.max(1, durationMs)),
    }
  }, [deadline, durationMs, now])
}
