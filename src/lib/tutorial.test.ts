import { describe, expect, it } from "vitest"

import { INITIAL_TUTORIAL_STATE, tutorialReducer } from "./tutorial"

describe("interactive tutorial", () => {
  it("only advances when the learner completes the requested action", () => {
    expect(tutorialReducer(INITIAL_TUTORIAL_STATE, { type: "choose-target", playerId: "mira" })).toBe(INITIAL_TUTORIAL_STATE)
    const card = tutorialReducer(INITIAL_TUTORIAL_STATE, { type: "choose-target", playerId: "rowan" })
    expect(card.stage).toBe("card")
    expect(tutorialReducer(card, { type: "choose-card", cardId: "lyra" })).toBe(card)
    const reveal = tutorialReducer(card, { type: "choose-card", cardId: "rowan" })
    const shuffle = tutorialReducer(reveal, { type: "continue" })
    const ready = tutorialReducer(shuffle, { type: "shuffle" })
    expect(ready).toEqual({ stage: "ready", cardOrder: ["mira", "lyra", "rowan"] })
  })
})
