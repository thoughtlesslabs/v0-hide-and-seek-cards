import type { AppPreferences, PlayerProfile } from "./game-types"
import { ACHIEVEMENTS_KEY } from "./achievements"

const PROFILE_KEY = "hide-seek.profile.v2"
const PREFERENCES_KEY = "hide-seek.preferences.v2"
export const SESSION_KEY = "hide-seek.session.v2"
export const TUTORIAL_KEY = "hide-seek.tutorial.v1"

export const DEFAULT_PREFERENCES: AppPreferences = {
  audioEnabled: true,
  soundEnabled: true,
  effectsVolume: 0.8,
  musicEnabled: true,
  musicVolume: 0.55,
  hapticsEnabled: true,
  motion: "system",
  highContrast: false,
}

function readJson<T>(key: string): T | undefined {
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : undefined
  } catch {
    return undefined
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in private browsing or embedded webviews.
  }
}

export function loadProfile(): PlayerProfile | undefined {
  if (typeof window === "undefined") return undefined
  const profile = readJson<Partial<PlayerProfile>>(PROFILE_KEY)
  if (!profile?.id || !profile.displayName || !profile.avatarId) return undefined
  return profile as PlayerProfile
}

export function saveProfile(profile: PlayerProfile): void {
  writeJson(PROFILE_KEY, profile)
}

export function loadPreferences(): AppPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES
  const stored = readJson<Partial<AppPreferences>>(PREFERENCES_KEY)
  const merged = { ...DEFAULT_PREFERENCES, ...stored }
  return {
    ...merged,
    effectsVolume: clampVolume(merged.effectsVolume),
    musicVolume: clampVolume(merged.musicVolume),
  }
}

function clampVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5
}

export function savePreferences(preferences: AppPreferences): void {
  writeJson(PREFERENCES_KEY, preferences)
}

export function hasCompletedTutorial(): boolean {
  if (typeof window === "undefined") return false
  return readJson<{ completed?: boolean }>(TUTORIAL_KEY)?.completed === true
}

export function saveTutorialCompleted(): void {
  writeJson(TUTORIAL_KEY, { completed: true, completedAt: Date.now() })
}

export function clearLocalData(): boolean {
  if (typeof window === "undefined") return false

  let cleared = true
  const keys = [PROFILE_KEY, PREFERENCES_KEY, SESSION_KEY, TUTORIAL_KEY, ACHIEVEMENTS_KEY]
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      cleared = false
    }
  }

  if (!cleared) return false
  try {
    return keys.every((key) => window.localStorage.getItem(key) === null)
  } catch {
    return false
  }
}

export function createLocalPlayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `player-${crypto.randomUUID()}`
  }
  return `player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
