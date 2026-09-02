import { describe, expect, it } from "vitest"

import { AnonymousSessionInputSchema, isValidDisplayName } from "./protocol"

describe("display name contract", () => {
  it.each(["Moonbeam", "O’Connor", "A&B", "Étoile 7", "fox_friend"])("accepts %s in both client and server validation", (displayName) => {
    expect(isValidDisplayName(displayName)).toBe(true)
    expect(AnonymousSessionInputSchema.safeParse({ displayName, avatarSeed: "lyra" }).success).toBe(true)
  })

  it.each(["A", "-Moon", "Sam 😊", "  "])("rejects %s in both client and server validation", (displayName) => {
    expect(isValidDisplayName(displayName)).toBe(false)
    expect(AnonymousSessionInputSchema.safeParse({ displayName, avatarSeed: "lyra" }).success).toBe(false)
  })
})
