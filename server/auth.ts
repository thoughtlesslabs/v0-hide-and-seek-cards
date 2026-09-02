import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto"

import type { AnonymousSessionInput, SessionResponse } from "../shared/protocol"
import { AVATAR_IDS, PROTOCOL_VERSION } from "../shared/protocol"
import { GameServerError } from "./errors"
import type { SessionIdentity } from "./model"

interface SessionTokenPayload {
  ver: 1
  iss: "hide-and-seek-cards"
  aud: "game-client"
  sub: string
  name: string
  avatar: string
  jti: string
  iat: number
  exp: number
}

export interface SessionTokenServiceOptions {
  secret?: string
  ttlSeconds?: number
  production?: boolean
  warn?: (message: string) => void
}

const ADJECTIVES = [
  "Amber",
  "Arcane",
  "Brisk",
  "Clever",
  "Crimson",
  "Daring",
  "Golden",
  "Hidden",
  "Merry",
  "Moonlit",
  "Nimble",
  "Quiet",
  "Silver",
  "Swift",
  "Velvet",
  "Wandering",
] as const

const NOUNS = [
  "Badger",
  "Comet",
  "Fox",
  "Griffin",
  "Hare",
  "Lantern",
  "Lynx",
  "Magpie",
  "Moth",
  "Oracle",
  "Otter",
  "Raven",
  "Rook",
  "Sphinx",
  "Stag",
  "Wisp",
] as const

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url")
  }
  const decoded = Buffer.from(value, "base64url")
  if (decoded.toString("base64url") !== value) throw new Error("Non-canonical base64url")
  return decoded
}

function decodeJson(value: string): unknown {
  return JSON.parse(decodeBase64Url(value).toString("utf8"))
}

function isSessionPayload(value: unknown): value is SessionTokenPayload {
  if (!value || typeof value !== "object") return false
  const payload = value as Partial<SessionTokenPayload>
  return (
    payload.ver === 1 &&
    payload.iss === "hide-and-seek-cards" &&
    payload.aud === "game-client" &&
    typeof payload.sub === "string" &&
    payload.sub.length > 0 &&
    typeof payload.name === "string" &&
    payload.name.length > 0 &&
    typeof payload.avatar === "string" &&
    payload.avatar.length > 0 &&
    typeof payload.jti === "string" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number"
  )
}

function generatedDisplayName(): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]
  const noun = NOUNS[randomInt(NOUNS.length)]
  return `${adjective} ${noun}`
}

export class SessionTokenService {
  private readonly secret: Buffer
  private readonly ttlSeconds: number

  constructor(options: SessionTokenServiceOptions = {}) {
    const production = options.production ?? process.env.NODE_ENV === "production"
    const configuredSecret = options.secret ?? process.env.SESSION_SIGNING_SECRET
    if (!configuredSecret && production) {
      throw new Error("SESSION_SIGNING_SECRET is required in production")
    }
    if (configuredSecret && Buffer.byteLength(configuredSecret) < 32) {
      throw new Error("SESSION_SIGNING_SECRET must contain at least 32 bytes")
    }

    this.secret = configuredSecret ? Buffer.from(configuredSecret) : randomBytes(48)
    this.ttlSeconds = options.ttlSeconds ?? 30 * 24 * 60 * 60
    if (!configuredSecret) {
      options.warn?.("Using an ephemeral development signing secret; sessions will not survive a restart")
    }
  }

  createAnonymousSession(
    profile?: AnonymousSessionInput,
    now = Date.now(),
  ): { identity: SessionIdentity; response: SessionResponse } {
    const issuedAtSeconds = Math.floor(now / 1000)
    const payload: SessionTokenPayload = {
      ver: 1,
      iss: "hide-and-seek-cards",
      aud: "game-client",
      sub: randomUUID(),
      name: profile?.displayName ?? generatedDisplayName(),
      avatar: profile?.avatarSeed ?? AVATAR_IDS[randomInt(AVATAR_IDS.length)],
      jti: randomUUID(),
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + this.ttlSeconds,
    }
    const token = this.sign(payload)
    const identity = this.toIdentity(payload)
    return {
      identity,
      response: {
        protocolVersion: PROTOCOL_VERSION,
        token,
        player: {
          id: identity.userId,
          displayName: identity.displayName,
          avatarSeed: identity.avatarSeed,
        },
        expiresAt: identity.expiresAt,
      },
    }
  }

  verify(token: string, now = Date.now()): SessionIdentity {
    const segments = token.split(".")
    if (segments.length !== 3) throw new GameServerError("UNAUTHORIZED", "Invalid session token")
    const [headerSegment, payloadSegment, signatureSegment] = segments
    const signedValue = `${headerSegment}.${payloadSegment}`
    const expectedSignature = this.signature(signedValue)
    let receivedSignature: Buffer
    try {
      receivedSignature = decodeBase64Url(signatureSegment)
    } catch {
      throw new GameServerError("UNAUTHORIZED", "Invalid session token")
    }
    if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) {
      throw new GameServerError("UNAUTHORIZED", "Invalid session token")
    }

    let header: unknown
    let payload: unknown
    try {
      header = decodeJson(headerSegment)
      payload = decodeJson(payloadSegment)
    } catch {
      throw new GameServerError("UNAUTHORIZED", "Invalid session token")
    }
    if (
      !header ||
      typeof header !== "object" ||
      (header as { alg?: unknown }).alg !== "HS256" ||
      (header as { typ?: unknown }).typ !== "JWT" ||
      (header as { ver?: unknown }).ver !== 1 ||
      !isSessionPayload(payload)
    ) {
      throw new GameServerError("UNAUTHORIZED", "Invalid session token")
    }
    if (payload.exp * 1000 <= now) throw new GameServerError("UNAUTHORIZED", "Session token has expired")
    if (payload.iat * 1000 > now + 60_000) throw new GameServerError("UNAUTHORIZED", "Session token is not active")
    return this.toIdentity(payload)
  }

  private sign(payload: SessionTokenPayload): string {
    const header = encodeJson({ alg: "HS256", typ: "JWT", ver: 1 })
    const body = encodeJson(payload)
    const signedValue = `${header}.${body}`
    return `${signedValue}.${this.signature(signedValue).toString("base64url")}`
  }

  private signature(value: string): Buffer {
    return createHmac("sha256", this.secret).update(value).digest()
  }

  private toIdentity(payload: SessionTokenPayload): SessionIdentity {
    return {
      userId: payload.sub,
      displayName: payload.name,
      avatarSeed: payload.avatar,
      tokenId: payload.jti,
      issuedAt: payload.iat * 1000,
      expiresAt: payload.exp * 1000,
    }
  }
}
