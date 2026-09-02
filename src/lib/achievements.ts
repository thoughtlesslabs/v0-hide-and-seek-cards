export const ACHIEVEMENTS_KEY = "hide-seek.achievements.v1"

export type AchievementId =
  | "tutorial_complete"
  | "first_flip"
  | "first_find"
  | "trapdoor_tourist"
  | "survivor"
  | "social_spirit"
  | "full_table"
  | "haunted_regular"

export interface AchievementDefinition {
  id: AchievementId
  name: string
  description: string
  icon: string
  target: number
  hidden?: boolean
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: "tutorial_complete", name: "Fresh Meat", description: "Survive the interactive tutorial.", icon: "🎓", target: 1 },
  { id: "first_flip", name: "No Turning Back", description: "Turn over your first card.", icon: "🃏", target: 1 },
  { id: "first_find", name: "Caught You", description: "Find the contestant you targeted.", icon: "🎯", target: 1 },
  { id: "trapdoor_tourist", name: "Wrong Floor", description: "Find your own card and take the trapdoor.", icon: "🕳️", target: 1 },
  { id: "survivor", name: "Last One Laughing", description: "Win your first full match.", icon: "🏆", target: 1 },
  { id: "social_spirit", name: "Heckle From Beyond", description: "Send a reaction during an online game.", icon: "👻", target: 1 },
  { id: "full_table", name: "Eight Enter", description: "Start a match at a full 8-player table.", icon: "🪑", target: 1 },
  { id: "haunted_regular", name: "Haunted Regular", description: "Finish 10 full matches.", icon: "🔟", target: 10 },
] as const

export type AchievementEvent =
  | { type: "tutorial_complete"; eventId?: string }
  | { type: "card_flipped"; eventId?: string }
  | { type: "target_found"; eventId?: string }
  | { type: "self_found"; eventId?: string }
  | { type: "game_won"; eventId?: string }
  | { type: "reaction_sent"; eventId?: string }
  | { type: "game_started"; players: number; eventId?: string }
  | { type: "game_completed"; eventId?: string }

export interface AchievementProgress {
  current: number
  unlockedAt?: number
}

export interface AchievementSnapshot {
  progress: Record<AchievementId, AchievementProgress>
  lastUnlocked?: AchievementDefinition
}

export interface AchievementProvider {
  readonly id: string
  initialize?(): Promise<void>
  reportProgress(id: AchievementId, percentComplete: number): Promise<void>
  showAchievements?(): Promise<void>
}

interface StoredAchievements {
  progress?: Partial<Record<AchievementId, AchievementProgress>>
  processedEventIds?: string[]
}

function blankProgress(): Record<AchievementId, AchievementProgress> {
  return Object.fromEntries(ACHIEVEMENTS.map((item) => [item.id, { current: 0 }])) as Record<AchievementId, AchievementProgress>
}

function loadStored(): StoredAchievements {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(ACHIEVEMENTS_KEY) || "{}") as StoredAchievements
  } catch {
    return {}
  }
}

class AchievementService {
  private progress = { ...blankProgress(), ...loadStored().progress }
  private processedEventIds = new Set(loadStored().processedEventIds || [])
  private providers = new Map<string, AchievementProvider>()
  private listeners = new Set<() => void>()
  private snapshot: AchievementSnapshot = { progress: this.progress }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.snapshot

  async registerProvider(provider: AchievementProvider): Promise<() => void> {
    this.providers.set(provider.id, provider)
    await provider.initialize?.()
    await Promise.all(ACHIEVEMENTS.map((definition) => this.reportToProvider(provider, definition)))
    return () => this.providers.delete(provider.id)
  }

  record(event: AchievementEvent): AchievementDefinition[] {
    if (event.eventId && this.processedEventIds.has(event.eventId)) return []
    if (event.eventId) {
      this.processedEventIds.add(event.eventId)
      if (this.processedEventIds.size > 160) this.processedEventIds.delete(this.processedEventIds.values().next().value as string)
    }

    const increments: Array<[AchievementId, number]> = []
    if (event.type === "tutorial_complete") increments.push(["tutorial_complete", 1])
    if (event.type === "card_flipped") increments.push(["first_flip", 1])
    if (event.type === "target_found") increments.push(["first_find", 1])
    if (event.type === "self_found") increments.push(["trapdoor_tourist", 1])
    if (event.type === "game_won") increments.push(["survivor", 1])
    if (event.type === "reaction_sent") increments.push(["social_spirit", 1])
    if (event.type === "game_started" && event.players >= 8) increments.push(["full_table", 1])
    if (event.type === "game_completed") increments.push(["haunted_regular", 1])

    const unlocked: AchievementDefinition[] = []
    for (const [id, amount] of increments) {
      const definition = ACHIEVEMENTS.find((item) => item.id === id)!
      const previous = this.progress[id]
      if (previous.current >= definition.target) continue
      const current = Math.min(definition.target, previous.current + amount)
      const firstUnlock = current >= definition.target && !previous.unlockedAt
      this.progress = {
        ...this.progress,
        [id]: { current, unlockedAt: firstUnlock ? Date.now() : previous.unlockedAt },
      }
      if (firstUnlock) unlocked.push(definition)
      for (const provider of this.providers.values()) void this.reportToProvider(provider, definition)
    }
    this.persist()
    this.snapshot = { progress: this.progress, lastUnlocked: unlocked.at(-1) }
    this.listeners.forEach((listener) => listener())
    return unlocked
  }

  clearLastUnlocked(): void {
    if (!this.snapshot.lastUnlocked) return
    this.snapshot = { progress: this.progress }
    this.listeners.forEach((listener) => listener())
  }

  reset(): void {
    this.progress = blankProgress()
    this.processedEventIds.clear()
    try { window.localStorage.removeItem(ACHIEVEMENTS_KEY) } catch { /* Storage may be unavailable. */ }
    this.snapshot = { progress: this.progress }
    this.listeners.forEach((listener) => listener())
  }

  private async reportToProvider(provider: AchievementProvider, definition: AchievementDefinition): Promise<void> {
    const progress = this.progress[definition.id]
    const percent = Math.min(100, Math.round((progress.current / definition.target) * 100))
    try { await provider.reportProgress(definition.id, percent) } catch { /* Local progress remains authoritative offline. */ }
  }

  private persist(): void {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify({
        progress: this.progress,
        processedEventIds: [...this.processedEventIds],
      } satisfies StoredAchievements))
    } catch { /* Storage may be unavailable. */ }
  }
}

export const achievements = new AchievementService()
