import { describe, expect, it } from "vitest"

import type { PlayerProfile } from "./game-types"
import { profileForGame } from "./profile-identity"

const PROFILE: PlayerProfile = { id: "local-player", displayName: "Lyra", avatarId: "lyra" }

describe("profileForGame", () => {
  it("keeps the local identity throughout Solo Game", () => {
    expect(profileForGame(PROFILE, "server-player", true)).toBe(PROFILE)
  })

  it("uses the authoritative identity for multiplayer", () => {
    expect(profileForGame(PROFILE, "server-player", false)).toEqual({ ...PROFILE, id: "server-player" })
  })
})
