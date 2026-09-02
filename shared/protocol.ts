import { z } from "zod"

export const PROTOCOL_VERSION = 1 as const

export const ALLOWED_REACTIONS = ["👍", "😄", "😮", "😢", "😡", "👏", "🎉", "🤔"] as const
export const AVATAR_IDS = ["lyra", "rowan", "mira", "bramble", "sol", "nia", "kestrel", "orin"] as const
export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._&'’-]*$/u

export function isValidDisplayName(value: string): boolean {
  const normalized = value.trim()
  return normalized.length >= 2 && normalized.length <= 24 && DISPLAY_NAME_PATTERN.test(normalized)
}

export type AllowedReaction = (typeof ALLOWED_REACTIONS)[number]
export type AvatarId = (typeof AVATAR_IDS)[number]
export type RoomStatus = "waiting" | "in_progress" | "finished"
export type PublicGamePhase =
  | "waiting"
  | "starting"
  | "select_target"
  | "select_card"
  | "reveal_result"
  | "shuffling"
  | "elimination"
  | "round_end"
  | "series_end"

export interface PublicPlayer {
  id: string
  displayName: string
  avatarSeed: string
  isBot: boolean
  isConnected: boolean
  isEliminated: boolean
  seriesWins: number
  isHost: boolean
}

/**
 * `token` is an opaque, short-lived selection handle. It is replaced after
 * every shuffle so clients cannot correlate a revealed card with its next
 * position. Hidden owner IDs and stable server card IDs never enter this type.
 */
export interface PublicCard {
  token: string
  position: number
  isRevealed: boolean
  revealedOwnerId: string | null
}

export interface PublicReaction {
  playerId: string
  emoji: AllowedReaction
  expiresAt: number
}

export interface PublicGameSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION
  roomId: string
  roomCode: string | null
  status: RoomStatus
  isPrivate: boolean
  hostPlayerId: string | null
  selfPlayerId: string
  maxPlayers: 4 | 8
  roundsToWin: 1 | 2 | 3
  version: number
  serverTime: number
  players: PublicPlayer[]
  cards: PublicCard[]
  phase: PublicGamePhase
  currentPlayerId: string | null
  targetPlayerId: string | null
  pendingEliminationId: string | null
  turnId: string | null
  deadline: number | null
  currentRound: number
  roundWinnerId: string | null
  seriesWinnerId: string | null
  lastMessage: string
  rematchVotes: string[]
  reactions: PublicReaction[]
  canAct: boolean
  canStart: boolean
  canVoteRematch: boolean
}

export interface AnonymousPlayer {
  id: string
  displayName: string
  avatarSeed: string
}

export interface SessionResponse {
  protocolVersion: typeof PROTOCOL_VERSION
  token: string
  player: AnonymousPlayer
  expiresAt: number
}

export const AnonymousSessionInputSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(DISPLAY_NAME_PATTERN),
    avatarSeed: z.enum(AVATAR_IDS),
  })
  .strict()

export type AnonymousSessionInput = z.infer<typeof AnonymousSessionInputSchema>

export const ProtocolErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "INVALID_INPUT",
  "RATE_LIMITED",
  "NOT_IN_ROOM",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "GAME_ALREADY_STARTED",
  "NOT_HOST",
  "CONFLICT",
  "INVALID_PHASE",
  "NOT_YOUR_TURN",
  "INVALID_TARGET",
  "INVALID_CARD",
  "DUPLICATE_COMMAND",
  "INTERNAL_ERROR",
])

export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>

export interface ProtocolError {
  code: ProtocolErrorCode
  message: string
  retryable: boolean
}

export type SocketAck<T> =
  | { ok: true; data: T; serverTime: number }
  | { ok: false; error: ProtocolError; serverTime: number }

export type AckCallback<T> = (response: SocketAck<T>) => void

const commandId = z.string().min(8).max(80)
const expectedVersion = z.number().int().nonnegative()
const turnId = z.string().min(8).max(100)

export const MatchmakingJoinInputSchema = z
  .object({
    commandId,
    maxPlayers: z.union([z.literal(4), z.literal(8)]),
    roundsToWin: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict()

export const PrivateCreateInputSchema = MatchmakingJoinInputSchema

export const PrivateJoinInputSchema = z
  .object({
    commandId,
    roomCode: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/),
  })
  .strict()

export const RoomStartInputSchema = z.object({ commandId }).strict()
/** Compatibility alias for clients built before room starts were shared by both modes. */
export const PrivateStartInputSchema = RoomStartInputSchema
export const RoomLeaveInputSchema = z.object({ commandId }).strict()

export const StateSyncInputSchema = z
  .object({
    knownVersion: z.number().int().nonnegative().optional(),
  })
  .strict()

export const SelectTargetInputSchema = z
  .object({
    commandId,
    expectedVersion,
    turnId,
    targetPlayerId: z.string().min(1).max(100),
  })
  .strict()

export const PickCardInputSchema = z
  .object({
    commandId,
    expectedVersion,
    turnId,
    cardToken: z.string().min(16).max(128),
  })
  .strict()

export const RematchVoteInputSchema = z
  .object({
    commandId,
    expectedVersion,
  })
  .strict()

export const ReactionInputSchema = z
  .object({
    commandId,
    emoji: z.enum(ALLOWED_REACTIONS),
  })
  .strict()

export type MatchmakingJoinInput = z.infer<typeof MatchmakingJoinInputSchema>
export type PrivateCreateInput = z.infer<typeof PrivateCreateInputSchema>
export type PrivateJoinInput = z.infer<typeof PrivateJoinInputSchema>
export type RoomStartInput = z.infer<typeof RoomStartInputSchema>
export type PrivateStartInput = RoomStartInput
export type RoomLeaveInput = z.infer<typeof RoomLeaveInputSchema>
export type StateSyncInput = z.infer<typeof StateSyncInputSchema>
export type SelectTargetInput = z.infer<typeof SelectTargetInputSchema>
export type PickCardInput = z.infer<typeof PickCardInputSchema>
export type RematchVoteInput = z.infer<typeof RematchVoteInputSchema>
export type ReactionInput = z.infer<typeof ReactionInputSchema>

export interface SessionReadyEvent {
  player: AnonymousPlayer
  serverTime: number
  resumedRoomId: string | null
}

export interface RoomClosedEvent {
  roomId: string
  reason: "left" | "empty" | "expired" | "server_shutdown"
}

export interface ServerErrorEvent {
  error: ProtocolError
  serverTime: number
}

export interface ClientToServerEvents {
  "matchmaking:join": (input: MatchmakingJoinInput, ack: AckCallback<PublicGameSnapshot>) => void
  "private:create": (input: PrivateCreateInput, ack: AckCallback<PublicGameSnapshot>) => void
  "private:join": (input: PrivateJoinInput, ack: AckCallback<PublicGameSnapshot>) => void
  "room:start": (input: RoomStartInput, ack: AckCallback<PublicGameSnapshot>) => void
  "private:start": (input: PrivateStartInput, ack: AckCallback<PublicGameSnapshot>) => void
  "room:leave": (input: RoomLeaveInput, ack: AckCallback<PublicGameSnapshot>) => void
  "state:sync": (input: StateSyncInput, ack: AckCallback<PublicGameSnapshot>) => void
  "game:select-target": (input: SelectTargetInput, ack: AckCallback<PublicGameSnapshot>) => void
  "game:pick-card": (input: PickCardInput, ack: AckCallback<PublicGameSnapshot>) => void
  "game:rematch-vote": (input: RematchVoteInput, ack: AckCallback<PublicGameSnapshot>) => void
  "reaction:send": (input: ReactionInput, ack: AckCallback<PublicGameSnapshot>) => void
}

export interface ServerToClientEvents {
  "session:ready": (event: SessionReadyEvent) => void
  "state:snapshot": (snapshot: PublicGameSnapshot) => void
  "room:closed": (event: RoomClosedEvent) => void
  "server:error": (event: ServerErrorEvent) => void
}

export type InterServerEvents = Record<never, never>

export interface SocketData {
  userId: string
  displayName: string
  avatarSeed: string
  tokenId: string
  issuedAt: number
  expiresAt: number
}
