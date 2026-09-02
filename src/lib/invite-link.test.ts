import { describe, expect, it } from "vitest"

import { roomInviteUrl } from "./invite-link"

describe("roomInviteUrl", () => {
  it("builds a root invite route on the public game origin", () => {
    expect(roomInviteUrl("abc234", "https://play.example.net/game")).toBe(
      "https://play.example.net/join/ABC234",
    )
  })
})
