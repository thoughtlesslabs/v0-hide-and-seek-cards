import { beforeEach, describe, expect, it } from "vitest"

import { ACHIEVEMENTS, achievements, type AchievementProvider } from "./achievements"

describe("achievement service", () => {
  beforeEach(() => achievements.reset())

  it("keeps stable canonical IDs for external provider mappings", () => {
    expect(ACHIEVEMENTS.map((item) => item.id)).toEqual([
      "tutorial_complete", "first_flip", "first_find", "trapdoor_tourist",
      "survivor", "social_spirit", "full_table", "haunted_regular",
    ])
  })

  it("deduplicates events and increments multi-step progress", () => {
    achievements.record({ type: "game_completed", eventId: "game-1" })
    achievements.record({ type: "game_completed", eventId: "game-1" })
    achievements.record({ type: "game_completed", eventId: "game-2" })
    expect(achievements.getSnapshot().progress.haunted_regular.current).toBe(2)
  })

  it("reports generic percentage progress to registered providers", async () => {
    const reports: Array<[string, number]> = []
    const provider: AchievementProvider = {
      id: "test",
      reportProgress: async (id, percent) => { reports.push([id, percent]) },
    }
    const unregister = await achievements.registerProvider(provider)
    reports.length = 0
    achievements.record({ type: "tutorial_complete" })
    await Promise.resolve()
    expect(reports).toContainEqual(["tutorial_complete", 100])
    unregister()
  })
})
