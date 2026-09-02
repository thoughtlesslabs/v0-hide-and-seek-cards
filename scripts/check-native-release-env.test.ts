import { describe, expect, it } from "vitest"

import { validateNativeReleaseOrigin } from "./native-release-origin.mjs"

describe("native release server guard", () => {
  it("accepts a public HTTPS origin", () => {
    expect(validateNativeReleaseOrigin(" HTTPS://PLAY.THOUGHTLESSLABS.COM/ ")).toBe(
      "https://play.thoughtlesslabs.com",
    )
  })

  it.each([
    undefined,
    "http://play.thoughtlesslabs.com",
    "https://localhost.",
    "https://example.com.",
    "https://foo.example.com.",
    "https://foo.example",
    "https://room.home.arpa",
    "https://192.168.1.12",
    "https://127.1",
    "https://[::1]",
    "https://play.thoughtlesslabs.com/game",
    "https://play.thoughtlesslabs.com:8443",
    "https://user:password@play.thoughtlesslabs.com",
    "https://play.thoughtlesslabs.com?token=nope",
    "https://play.thoughtlesslabs.com#fragment",
  ])("rejects a non-release origin: %s", (value) => {
    expect(() => validateNativeReleaseOrigin(value)).toThrow("VITE_GAME_SERVER_URL")
  })
})
