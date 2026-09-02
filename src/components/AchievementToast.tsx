import { useEffect, useSyncExternalStore } from "react"
import { Trophy } from "lucide-react"

import { achievements } from "../lib/achievements"

export function AchievementToast() {
  const snapshot = useSyncExternalStore(achievements.subscribe, achievements.getSnapshot, achievements.getSnapshot)
  const unlocked = snapshot.lastUnlocked

  useEffect(() => {
    if (!unlocked) return
    const timer = window.setTimeout(() => achievements.clearLastUnlocked(), 4200)
    return () => window.clearTimeout(timer)
  }, [unlocked])

  if (!unlocked) return null
  return (
    <aside className="achievement-toast" role="status" aria-live="polite">
      <span className="achievement-toast__icon">{unlocked.icon}</span>
      <span><small><Trophy aria-hidden="true" /> Achievement unlocked</small><strong>{unlocked.name}</strong></span>
    </aside>
  )
}
