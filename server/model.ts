import { DEFAULT_ENGINE_CONFIG, type PrivateGameState } from "../shared/game-engine"
import { ALLOWED_REACTIONS, type AllowedReaction, type RoomStatus } from "../shared/protocol"
import { z } from "zod"

export interface SessionIdentity {
  userId: string
  displayName: string
  avatarSeed: string
  tokenId: string
  issuedAt: number
  expiresAt: number
}

export interface RoomMember {
  userId: string
  displayName: string
  avatarSeed: string
  activeSocketIds: string[]
  disconnectedAt: number | null
  joinedAt: number
}

export interface StoredReaction {
  playerId: string
  emoji: AllowedReaction
  expiresAt: number
}

export interface PersistedRoom {
  schemaVersion: 1
  id: string
  code: string | null
  isPrivate: boolean
  hostPlayerId: string | null
  status: RoomStatus
  maxPlayers: 4 | 8
  roundsToWin: 1 | 2 | 3
  revision: number
  createdAt: number
  updatedAt: number
  matchmakingDeadline: number | null
  members: RoomMember[]
  game: PrivateGameState | null
  reactions: StoredReaction[]
  processedCommandIds: string[]
}

const safeTimestamp = z.number().int().nonnegative().safe()
const nullableId = z.string().min(1).max(256).nullable()

const engineConfigSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    return {
      startDurationMs: DEFAULT_ENGINE_CONFIG.startDurationMs,
      shuffleDurationMs: DEFAULT_ENGINE_CONFIG.shuffleDurationMs,
      ...(value as Record<string, unknown>),
    }
  },
  z
    .object({
      startDurationMs: z.number().int().positive().safe(),
      turnDurationMs: z.number().int().positive().safe(),
      botThinkDurationMs: z.number().int().positive().safe(),
      revealDurationMs: z.number().int().positive().safe(),
      shuffleDurationMs: z.number().int().positive().safe(),
      eliminationDurationMs: z.number().int().positive().safe(),
      roundEndDurationMs: z.number().int().positive().safe(),
    })
    .strict(),
)

const privatePlayerStateSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || !("observedCards" in value)) return value
    const player = { ...(value as Record<string, unknown>) }
    delete player.observedCards
    return player
  },
  z.object({
    id: z.string().min(1).max(256),
    displayName: z.string().min(1).max(100),
    avatarSeed: z.string().min(1).max(100),
    isBot: z.boolean(),
    canReconnect: z.boolean(),
    isConnected: z.boolean(),
    isEliminated: z.boolean(),
    seriesWins: z.number().int().nonnegative().safe(),
  }).strict(),
)

const privateCardStateSchema = z
  .object({
    secretId: z.string().min(1).max(256),
    ownerId: z.string().min(1).max(256),
    selectionToken: z.string().min(1).max(256),
    position: z.number().int().nonnegative().safe(),
    isRevealed: z.boolean(),
  })
  .strict()

const privateGameStateSchema = z
  .object({
    gameId: z.string().min(1).max(256),
    version: z.number().int().nonnegative().safe(),
    roundsToWin: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    currentRound: z.number().int().positive().safe(),
    players: z.array(privatePlayerStateSchema).min(2).max(8),
    cards: z.array(privateCardStateSchema).max(8),
    phase: z.enum([
      "starting",
      "select_target",
      "select_card",
      "reveal_result",
      "shuffling",
      "elimination",
      "round_end",
      "series_end",
    ]),
    currentPlayerId: z.string().min(1).max(256),
    targetPlayerId: nullableId,
    pendingEliminationId: nullableId,
    selectedCardSecretId: nullableId,
    turnId: z.string().min(1).max(256),
    deadline: safeTimestamp.nullable(),
    roundWinnerId: nullableId,
    seriesWinnerId: nullableId,
    rematchVotes: z.array(z.string().min(1).max(256)).max(8),
    lastMessage: z.string().max(500),
    config: engineConfigSchema,
  })
  .strict()

const roomMemberSchema = z
  .object({
    userId: z.string().min(1).max(256),
    displayName: z.string().min(1).max(100),
    avatarSeed: z.string().min(1).max(100),
    // Older snapshots may contain transport IDs. New stores strip them before
    // persistence, and RoomManager always clears them while rehydrating.
    activeSocketIds: z.array(z.string().min(1).max(256)).max(32),
    disconnectedAt: safeTimestamp.nullable(),
    joinedAt: safeTimestamp,
  })
  .strict()

const storedReactionSchema = z
  .object({
    playerId: z.string().min(1).max(256),
    emoji: z.enum(ALLOWED_REACTIONS),
    expiresAt: safeTimestamp,
  })
  .strict()

export const PersistedRoomSchema: z.ZodType<PersistedRoom> = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(256),
    code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/).nullable(),
    isPrivate: z.boolean(),
    hostPlayerId: nullableId,
    status: z.enum(["waiting", "in_progress", "finished"]),
    maxPlayers: z.union([z.literal(4), z.literal(8)]),
    roundsToWin: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    revision: z.number().int().nonnegative().safe(),
    createdAt: safeTimestamp,
    updatedAt: safeTimestamp,
    matchmakingDeadline: safeTimestamp.nullable(),
    members: z.array(roomMemberSchema).max(8),
    game: privateGameStateSchema.nullable(),
    reactions: z.array(storedReactionSchema).max(8),
    processedCommandIds: z.array(z.string().min(1).max(100)).max(256),
  })
  .strict()

export function parsePersistedRoom(value: unknown): PersistedRoom | null {
  const parsed = PersistedRoomSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
