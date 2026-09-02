import { describe, expect, it } from "vitest"

import { SessionTokenService } from "./auth"

describe("anonymous session tokens", () => {
  it("signs the server-derived player ID and validated profile", () => {
    const service = new SessionTokenService({ secret: "a".repeat(48), ttlSeconds: 60 })
    const created = service.createAnonymousSession({ displayName: "Silver Fox", avatarSeed: "lyra" }, 1_000_000)
    const verified = service.verify(created.response.token, 1_001_000)

    expect(verified.userId).toBe(created.response.player.id)
    expect(verified.displayName).toBe("Silver Fox")
    expect(verified.avatarSeed).toBe("lyra")
  })

  it("rejects a modified token", () => {
    const service = new SessionTokenService({ secret: "b".repeat(48), ttlSeconds: 60 })
    const created = service.createAnonymousSession({ displayName: "Amber Rook", avatarSeed: "orin" }, 1_000_000)
    const [header, payload, signature] = created.response.token.split(".")
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
    decoded.name = "Tampered Player"
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url")
    const tampered = `${header}.${tamperedPayload}.${signature}`
    expect(() => service.verify(tampered, 1_001_000)).toThrow("Invalid session token")
  })

  it("rejects a non-canonical signature encoding even when it decodes to the same bytes", () => {
    const service = new SessionTokenService({ secret: "c".repeat(48), ttlSeconds: 60 })
    const created = service.createAnonymousSession({ displayName: "Quiet Moth", avatarSeed: "mira" }, 1_000_000)
    const segments = created.response.token.split(".")
    const signature = segments[2]
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    const canonicalLastIndex = alphabet.indexOf(signature.at(-1)!)
    const equivalentLastCharacter = alphabet[canonicalLastIndex + 1]
    const alternateSignature = `${signature.slice(0, -1)}${equivalentLastCharacter}`

    expect(Buffer.from(alternateSignature, "base64url")).toEqual(Buffer.from(signature, "base64url"))
    expect(() => service.verify(`${segments[0]}.${segments[1]}.${alternateSignature}`, 1_001_000)).toThrow(
      "Invalid session token",
    )
  })
})
