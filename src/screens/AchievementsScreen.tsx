import { useSyncExternalStore } from "react"
import { Lock, Trophy } from "lucide-react"

import { AppHeader } from "../components/AppHeader"
import { ACHIEVEMENTS, achievements } from "../lib/achievements"

interface AchievementsScreenProps { onBack: () => void }

export function AchievementsScreen({ onBack }: AchievementsScreenProps) {
  const snapshot = useSyncExternalStore(achievements.subscribe, achievements.getSnapshot, achievements.getSnapshot)
  const unlockedCount = ACHIEVEMENTS.filter((item) => snapshot.progress[item.id].unlockedAt).length
  return (
    <main className="screen scroll-screen">
      <AppHeader eyebrow="Trophy Case" onBack={onBack} />
      <article className="achievements-page">
        <header className="achievements-intro">
          <span><Trophy aria-hidden="true" /></span>
          <div><p className="eyebrow">Cartoon peril pays</p><h1>{unlockedCount} of {ACHIEVEMENTS.length} unlocked</h1><p>Progress is saved on this device and will sync with platform services when connected.</p></div>
        </header>
        <div className="achievement-list">
          {ACHIEVEMENTS.map((item) => {
            const progress = snapshot.progress[item.id]
            const unlocked = Boolean(progress.unlockedAt)
            const percent = Math.round((progress.current / item.target) * 100)
            return (
              <section className={`achievement-row ${unlocked ? "achievement-row--unlocked" : ""}`} key={item.id}>
                <span className="achievement-row__icon">{unlocked ? item.icon : <Lock aria-hidden="true" />}</span>
                <div><strong>{item.name}</strong><p>{item.description}</p><div className="achievement-progress"><i style={{ width: `${percent}%` }} /></div></div>
                <small>{item.target > 1 ? `${progress.current}/${item.target}` : unlocked ? "Done" : "Locked"}</small>
              </section>
            )
          })}
        </div>
      </article>
    </main>
  )
}
