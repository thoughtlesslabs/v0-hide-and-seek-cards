import type { AvatarId } from "../../shared/protocol"

export type { AvatarId } from "../../shared/protocol"

export type MotionPreference = "system" | "full" | "reduced"

export interface PlayerProfile {
  id: string
  displayName: string
  avatarId: AvatarId
}

export interface AppPreferences {
  audioEnabled: boolean
  soundEnabled: boolean
  effectsVolume: number
  musicEnabled: boolean
  musicVolume: number
  hapticsEnabled: boolean
  motion: MotionPreference
  highContrast: boolean
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline" | "error"

export interface LobbyPlayerSnapshot {
  id: string
  displayName: string
  avatarId: AvatarId | string
  avatarUrl?: string
  isBot: boolean
  isHost: boolean
  isReady: boolean
}

export interface LobbySnapshot {
  id: string
  mode: "quick" | "private"
  inviteCode?: string
  hostId?: string
  players: LobbyPlayerSnapshot[]
  maxPlayers: number
  roundsToWin: number
  status: "joining" | "waiting" | "starting"
  startsAt?: number
  canStart?: boolean
}

export type GamePhase =
  | "starting"
  | "select_target"
  | "select_card"
  | "revealing"
  | "shuffling"
  | "eliminating"
  | "round_end"
  | "series_end"

export interface GamePlayerSnapshot {
  id: string
  displayName: string
  avatarId: AvatarId | string
  avatarUrl?: string
  isBot: boolean
  isEliminated: boolean
  roundWins: number
}

export interface GameCardSnapshot {
  id: string
  position: number
  isRevealed: boolean
  /** Only present while the authoritative game is revealing this card. */
  revealedOwnerId?: string
}

export type GameEventKind = "turn" | "target" | "miss" | "found" | "self_found" | "shuffle" | "round" | "win"

export interface GameEventSnapshot {
  id: string
  kind: GameEventKind
  message: string
  actorId?: string
  targetId?: string
  ownerId?: string
}

export interface GameSnapshot {
  id: string
  lobbyId: string
  version: number
  phase: GamePhase
  players: GamePlayerSnapshot[]
  cards: GameCardSnapshot[]
  currentPlayerId: string
  targetPlayerId?: string
  round: number
  roundsToWin: number
  turnDeadlineAt?: number
  turnDurationMs?: number
  roundWinnerId?: string
  winnerId?: string
  /** Player currently being given the elimination reveal/animation. */
  pendingEliminationId?: string
  rematchVotes?: string[]
  reactions?: Array<{ playerId: string; emoji: string; expiresAt: number }>
  canAct?: boolean
  message: string
  lastEvent?: GameEventSnapshot
}

export interface GameClientError {
  code: string
  message: string
  recoverable: boolean
}

export interface GameClientState {
  connection: ConnectionStatus
  sessionId?: string
  selfPlayerId?: string
  lobby?: LobbySnapshot
  game?: GameSnapshot
  error?: GameClientError
}

export type MatchOptions = {
  maxPlayers: 4 | 8
  roundsToWin: 1 | 2 | 3
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  maxPlayers: 4,
  roundsToWin: 2,
}
