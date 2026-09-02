import {
  applyGameCommand,
  createGame,
  projectGameState,
  secureRandomSource,
  validateGameState,
  type EngineConfig,
  type EnginePlayerInput,
  type RandomSource,
} from "../shared/game-engine"
import {
  PROTOCOL_VERSION,
  type AllowedReaction,
  type PickCardInput,
  type PrivateCreateInput,
  type PrivateJoinInput,
  type PublicGameSnapshot,
  type RematchVoteInput,
  type SelectTargetInput,
} from "../shared/protocol"
import { GameServerError } from "./errors"
import { parsePersistedRoom, type PersistedRoom, type RoomMember, type SessionIdentity } from "./model"
import type { SnapshotStore } from "./snapshot-store"

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const MAX_PROCESSED_COMMANDS = 256

export interface RoomManagerOptions {
  store: SnapshotStore
  random?: RandomSource
  now?: () => number
  matchmakingWaitMs?: number
  disconnectGraceMs?: number
  reactionTtlMs?: number
  idleRoomTtlMs?: number
  maxSocketsPerUser?: number
  engineConfig?: Partial<EngineConfig>
  warn?: (message: string, error?: unknown) => void
}

export interface RoomManagerStats {
  rooms: number
  waitingRooms: number
  activeGames: number
  connectedPlayers: number
  snapshotStore: string
}

type RoomUpdateListener = (roomId: string) => void
type RoomClosedListener = (roomId: string, reason: "empty" | "expired" | "server_shutdown") => void
type UserRemovedListener = (userId: string, roomId: string, reason: "left" | "expired") => void

export class RoomManager {
  private readonly rooms = new Map<string, PersistedRoom>()
  private readonly userRooms = new Map<string, string>()
  private readonly codeRooms = new Map<string, string>()
  private readonly queueTails = new Map<string, Promise<void>>()
  private readonly updateListeners = new Set<RoomUpdateListener>()
  private readonly closedListeners = new Set<RoomClosedListener>()
  private readonly userRemovedListeners = new Set<UserRemovedListener>()
  private readonly store: SnapshotStore
  private readonly random: RandomSource
  private readonly now: () => number
  private readonly matchmakingWaitMs: number
  private readonly disconnectGraceMs: number
  private readonly reactionTtlMs: number
  private readonly idleRoomTtlMs: number
  private readonly maxSocketsPerUser: number
  private readonly engineConfig?: Partial<EngineConfig>
  private readonly warn: (message: string, error?: unknown) => void

  constructor(options: RoomManagerOptions) {
    this.store = options.store
    this.random = options.random ?? secureRandomSource
    this.now = options.now ?? Date.now
    this.matchmakingWaitMs = options.matchmakingWaitMs ?? 8_000
    this.disconnectGraceMs = options.disconnectGraceMs ?? 30_000
    this.reactionTtlMs = options.reactionTtlMs ?? 5_000
    this.idleRoomTtlMs = options.idleRoomTtlMs ?? 2 * 60 * 60_000
    this.maxSocketsPerUser = options.maxSocketsPerUser ?? 4
    this.engineConfig = options.engineConfig
    this.warn = options.warn ?? console.warn
  }

  async initialize(): Promise<void> {
    await this.restoreSnapshots(await this.store.loadAll())
  }

  async recoverSnapshots(): Promise<string[]> {
    if (this.store.kind !== "memory-fallback") return []

    const loaded = await this.store.loadAll()
    if (this.store.kind === "memory-fallback") return []

    return this.withGlobalLock(() => this.restoreSnapshots(loaded))
  }

  private async restoreSnapshots(loaded: PersistedRoom[]): Promise<string[]> {
    const recoveredRoomIds: string[] = []
    const now = this.now()
    const candidates: PersistedRoom[] = []
    for (const rawCandidate of loaded as unknown[]) {
      const candidate = parsePersistedRoom(rawCandidate)
      if (!candidate) {
        const candidateId =
          rawCandidate && typeof rawCandidate === "object" && typeof (rawCandidate as { id?: unknown }).id === "string"
            ? (rawCandidate as { id: string }).id
            : null
        this.warn(`Discarding malformed room snapshot${candidateId ? ` ${candidateId}` : ""}`)
        if (candidateId) await this.store.delete(candidateId)
        continue
      }
      candidates.push(candidate)
    }

    for (const candidate of candidates.sort((left, right) => right.updatedAt - left.updatedAt)) {
      if (this.rooms.has(candidate.id)) continue
      const conflictingUser = candidate.members.find((member) => this.userRooms.has(member.userId))
      const conflictingCode = candidate.code ? this.codeRooms.get(candidate.code) : undefined
      if (conflictingUser || conflictingCode) {
        this.warn(
          `Skipping recovered room ${candidate.id} because newer local room state owns its ${
            conflictingUser ? `member ${conflictingUser.userId}` : `code ${candidate.code}`
          }`,
        )
        continue
      }
      const errors = this.validateRestoredRoom(candidate)
      if (errors.length > 0) {
        this.warn(`Discarding invalid room snapshot ${candidate.id}: ${errors.join(", ")}`)
        await this.store.delete(candidate.id)
        continue
      }

      const room: PersistedRoom = {
        ...candidate,
        members: candidate.members
          .filter((member) => !this.userRooms.has(member.userId))
          .map((member) => ({ ...member, activeSocketIds: [], disconnectedAt: now })),
        reactions: [],
        processedCommandIds: [...candidate.processedCommandIds].slice(-MAX_PROCESSED_COMMANDS),
      }
      if (room.members.length === 0 && !room.game) {
        await this.store.delete(room.id)
        continue
      }

      if (room.game) {
        for (const member of room.members) {
          const result = applyGameCommand(room.game, {
            type: "set_connection",
            playerId: member.userId,
            connected: false,
            now,
          })
          if (result.ok && result.changed) room.game = result.state
        }
        room.revision = room.game.version
      }
      room.updatedAt = now
      this.rooms.set(room.id, room)
      if (room.code) this.codeRooms.set(room.code, room.id)
      for (const member of room.members) this.userRooms.set(member.userId, room.id)
      await this.store.save(room)
      recoveredRoomIds.push(room.id)
    }
    return recoveredRoomIds
  }

  onRoomUpdated(listener: RoomUpdateListener): () => void {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  onRoomClosed(listener: RoomClosedListener): () => void {
    this.closedListeners.add(listener)
    return () => this.closedListeners.delete(listener)
  }

  onUserRemoved(listener: UserRemovedListener): () => void {
    this.userRemovedListeners.add(listener)
    return () => this.userRemovedListeners.delete(listener)
  }

  stats(): RoomManagerStats {
    let waitingRooms = 0
    let activeGames = 0
    let connectedPlayers = 0
    for (const room of this.rooms.values()) {
      if (room.status === "waiting") waitingRooms += 1
      if (room.game && room.status !== "waiting") activeGames += 1
      connectedPlayers += room.members.filter((member) => member.activeSocketIds.length > 0).length
    }
    return {
      rooms: this.rooms.size,
      waitingRooms,
      activeGames,
      connectedPlayers,
      snapshotStore: this.store.kind,
    }
  }

  async resume(identity: SessionIdentity, socketId: string): Promise<PublicGameSnapshot | null> {
    const roomId = this.userRooms.get(identity.userId)
    if (!roomId) return null
    return this.withRoomLock(roomId, async () => {
      const room = this.rooms.get(roomId)
      if (!room) {
        this.userRooms.delete(identity.userId)
        return null
      }
      const member = room.members.find((candidate) => candidate.userId === identity.userId)
      if (!member) {
        this.userRooms.delete(identity.userId)
        return null
      }

      if (!member.activeSocketIds.includes(socketId)) {
        if (member.activeSocketIds.length >= this.maxSocketsPerUser) {
          throw new GameServerError("RATE_LIMITED", "This player card is already open on too many devices", true)
        }
        member.activeSocketIds.push(socketId)
      }
      member.disconnectedAt = null
      if (room.game) {
        const result = applyGameCommand(room.game, {
          type: "set_connection",
          playerId: identity.userId,
          connected: true,
          reclaimControl: true,
          now: this.now(),
        })
        if (result.ok && result.changed) {
          room.game = result.state
          room.revision = result.state.version
        }
      } else {
        room.revision += 1
      }
      room.updatedAt = this.now()
      await this.store.save(room)
      this.notifyUpdated(room.id)
      return this.snapshot(room, identity.userId)
    })
  }

  async disconnect(userId: string, socketId: string): Promise<void> {
    const roomId = this.userRooms.get(userId)
    if (!roomId) return
    await this.withRoomLock(roomId, async () => {
      const room = this.rooms.get(roomId)
      const member = room?.members.find((candidate) => candidate.userId === userId)
      if (!room || !member) return
      member.activeSocketIds = member.activeSocketIds.filter((id) => id !== socketId)
      if (member.activeSocketIds.length > 0) return

      const now = this.now()
      member.disconnectedAt = now
      if (room.game) {
        const result = applyGameCommand(room.game, {
          type: "set_connection",
          playerId: userId,
          connected: false,
          now,
        })
        if (result.ok && result.changed) {
          room.game = result.state
          room.revision = result.state.version
        }
      } else {
        room.revision += 1
      }
      room.updatedAt = now
      await this.store.save(room)
      this.notifyUpdated(room.id)
    })
  }

  async joinMatchmaking(
    identity: SessionIdentity,
    socketId: string,
    input: { commandId: string; maxPlayers: 4 | 8; roundsToWin: 1 | 2 | 3 },
  ): Promise<PublicGameSnapshot> {
    return this.withGlobalLock(async () => {
      const existing = await this.existingSnapshot(identity.userId)
      if (existing) return existing

      let room = [...this.rooms.values()].find(
        (candidate) =>
          !candidate.isPrivate &&
          candidate.status === "waiting" &&
          candidate.maxPlayers === input.maxPlayers &&
          candidate.roundsToWin === input.roundsToWin &&
          candidate.members.length < candidate.maxPlayers,
      )

      if (!room) {
        const now = this.now()
        room = {
          schemaVersion: 1,
          id: `room-${this.random.id(12)}`,
          code: null,
          isPrivate: false,
          hostPlayerId: identity.userId,
          status: "waiting",
          maxPlayers: input.maxPlayers,
          roundsToWin: input.roundsToWin,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          matchmakingDeadline: now + this.matchmakingWaitMs,
          members: [],
          game: null,
          reactions: [],
          processedCommandIds: [],
        }
        this.rooms.set(room.id, room)
      }

      return this.withRoomLock(room.id, async () => {
        if (room!.members.length >= room!.maxPlayers) throw new GameServerError("ROOM_FULL", "Room is full")
        room!.members.push(this.createMember(identity, socketId))
        this.userRooms.set(identity.userId, room!.id)
        room!.revision += 1
        this.rememberCommand(room!, input.commandId)
        if (room!.members.length === room!.maxPlayers) this.startGame(room!, this.now())
        room!.updatedAt = this.now()
        await this.store.save(room!)
        this.notifyUpdated(room!.id)
        return this.snapshot(room!, identity.userId)
      })
    })
  }

  async createPrivateRoom(
    identity: SessionIdentity,
    socketId: string,
    input: PrivateCreateInput,
  ): Promise<PublicGameSnapshot> {
    return this.withGlobalLock(async () => {
      const existing = await this.existingSnapshot(identity.userId)
      if (existing) return existing
      const now = this.now()
      const room: PersistedRoom = {
        schemaVersion: 1,
        id: `room-${this.random.id(12)}`,
        code: this.uniqueRoomCode(),
        isPrivate: true,
        hostPlayerId: identity.userId,
        status: "waiting",
        maxPlayers: input.maxPlayers,
        roundsToWin: input.roundsToWin,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        matchmakingDeadline: null,
        members: [this.createMember(identity, socketId)],
        game: null,
        reactions: [],
        processedCommandIds: [input.commandId],
      }
      this.rooms.set(room.id, room)
      this.codeRooms.set(room.code!, room.id)
      this.userRooms.set(identity.userId, room.id)
      await this.store.save(room)
      this.notifyUpdated(room.id)
      return this.snapshot(room, identity.userId)
    })
  }

  async joinPrivateRoom(
    identity: SessionIdentity,
    socketId: string,
    input: PrivateJoinInput,
  ): Promise<PublicGameSnapshot> {
    return this.withGlobalLock(async () => {
      const existing = await this.existingSnapshot(identity.userId)
      if (existing) return existing
      const roomId = this.codeRooms.get(input.roomCode)
      if (!roomId) throw new GameServerError("ROOM_NOT_FOUND", "Private room not found")

      return this.withRoomLock(roomId, async () => {
        const room = this.requireRoom(roomId)
        if (room.status !== "waiting" || room.game) {
          throw new GameServerError("GAME_ALREADY_STARTED", "This game has already started")
        }
        if (room.members.length >= room.maxPlayers) throw new GameServerError("ROOM_FULL", "Room is full")
        room.members.push(this.createMember(identity, socketId))
        room.revision += 1
        room.updatedAt = this.now()
        this.rememberCommand(room, input.commandId)
        this.userRooms.set(identity.userId, room.id)
        await this.store.save(room)
        this.notifyUpdated(room.id)
        return this.snapshot(room, identity.userId)
      })
    })
  }

  async startHostedGame(userId: string, commandId: string): Promise<PublicGameSnapshot> {
    const roomId = this.requireUserRoomId(userId)
    return this.withRoomLock(roomId, async () => {
      const room = this.requireRoom(roomId)
      if (this.isDuplicate(room, commandId)) return this.snapshot(room, userId)
      if (room.hostPlayerId !== userId) {
        throw new GameServerError("NOT_HOST", "Only the room host can start this game")
      }
      if (room.game || room.status !== "waiting") {
        throw new GameServerError("GAME_ALREADY_STARTED", "This game has already started")
      }
      this.startGame(room, this.now())
      this.rememberCommand(room, commandId)
      room.updatedAt = this.now()
      await this.store.save(room)
      this.notifyUpdated(room.id)
      return this.snapshot(room, userId)
    })
  }

  async selectTarget(userId: string, input: SelectTargetInput): Promise<PublicGameSnapshot> {
    return this.applyPlayerCommand(userId, input.commandId, (room) =>
      applyGameCommand(room.game!, {
        type: "select_target",
        playerId: userId,
        targetPlayerId: input.targetPlayerId,
        expectedVersion: input.expectedVersion,
        turnId: input.turnId,
        now: this.now(),
      }),
    )
  }

  async pickCard(userId: string, input: PickCardInput): Promise<PublicGameSnapshot> {
    return this.applyPlayerCommand(userId, input.commandId, (room) =>
      applyGameCommand(room.game!, {
        type: "pick_card",
        playerId: userId,
        cardToken: input.cardToken,
        expectedVersion: input.expectedVersion,
        turnId: input.turnId,
        now: this.now(),
      }),
    )
  }

  async voteRematch(userId: string, input: RematchVoteInput): Promise<PublicGameSnapshot> {
    return this.applyPlayerCommand(userId, input.commandId, (room) =>
      applyGameCommand(
        room.game!,
        {
          type: "rematch_vote",
          playerId: userId,
          expectedVersion: input.expectedVersion,
          now: this.now(),
        },
        this.random,
      ),
    )
  }

  async addReaction(userId: string, commandId: string, emoji: AllowedReaction): Promise<PublicGameSnapshot> {
    const roomId = this.requireUserRoomId(userId)
    return this.withRoomLock(roomId, async () => {
      const room = this.requireRoom(roomId)
      this.requireMember(room, userId)
      if (this.isDuplicate(room, commandId)) return this.snapshot(room, userId)
      const now = this.now()
      room.reactions = room.reactions.filter((reaction) => reaction.expiresAt > now && reaction.playerId !== userId)
      room.reactions.push({ playerId: userId, emoji, expiresAt: now + this.reactionTtlMs })
      this.rememberCommand(room, commandId)
      room.updatedAt = now
      await this.store.save(room)
      this.notifyUpdated(room.id)
      return this.snapshot(room, userId)
    })
  }

  async sync(userId: string): Promise<PublicGameSnapshot> {
    const roomId = this.requireUserRoomId(userId)
    const room = this.requireRoom(roomId)
    this.requireMember(room, userId)
    return this.snapshot(room, userId)
  }

  async leave(userId: string, commandId: string): Promise<PublicGameSnapshot> {
    return this.withGlobalLock(async () => {
      const roomId = this.requireUserRoomId(userId)
      return this.withRoomLock(roomId, async () => {
        const room = this.requireRoom(roomId)
        if (this.isDuplicate(room, commandId)) return this.snapshot(room, userId)
        this.requireMember(room, userId)
        const now = this.now()

        if (room.game) {
          const result = applyGameCommand(room.game, {
            type: "convert_to_bot",
            playerId: userId,
            canReconnect: false,
            now,
          })
          if (result.ok && result.changed) {
            room.game = result.state
            room.revision = result.state.version
          }
        }

        room.members = room.members.filter((member) => member.userId !== userId)
        this.userRooms.delete(userId)
        for (const listener of this.userRemovedListeners) listener(userId, room.id, "left")
        if (room.hostPlayerId === userId) room.hostPlayerId = room.members[0]?.userId ?? null
        if (!room.game) room.revision += 1
        this.rememberCommand(room, commandId)
        room.updatedAt = now
        const leavingSnapshot = this.snapshot(room, userId)

        if (room.members.length === 0) {
          await this.deleteRoom(room, "empty")
        } else {
          await this.store.save(room)
          this.notifyUpdated(room.id)
        }
        return leavingSnapshot
      })
    })
  }

  snapshotForRoom(roomId: string, userId: string): PublicGameSnapshot | null {
    const room = this.rooms.get(roomId)
    if (!room || !room.members.some((member) => member.userId === userId)) return null
    return this.snapshot(room, userId)
  }

  roomIdForUser(userId: string): string | null {
    return this.userRooms.get(userId) ?? null
  }

  async tick(): Promise<void> {
    const roomIds = [...this.rooms.keys()]
    await Promise.all(roomIds.map((roomId) => this.tickRoom(roomId)))
  }

  async flush(): Promise<void> {
    while (this.queueTails.size > 0) {
      await Promise.allSettled([...this.queueTails.values()])
    }
    await Promise.all([...this.rooms.values()].map((room) => this.store.save(room)))
  }

  async shutdown(): Promise<void> {
    await this.flush()
    for (const room of this.rooms.values()) {
      for (const listener of this.closedListeners) listener(room.id, "server_shutdown")
    }
  }

  private async tickRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room) return

    if (!room.isPrivate && room.status === "waiting" && room.matchmakingDeadline !== null) {
      await this.withGlobalLock(async () => {
        await this.withRoomLock(roomId, async () => {
          const current = this.rooms.get(roomId)
          const now = this.now()
          if (!current || current.status !== "waiting" || current.matchmakingDeadline === null) return
          if (now < current.matchmakingDeadline) return
          if (current.members.length === 0) {
            await this.deleteRoom(current, "empty")
            return
          }
          this.startGame(current, now)
          current.updatedAt = now
          await this.store.save(current)
          this.notifyUpdated(current.id)
        })
      })
      return
    }

    await this.withRoomLock(roomId, async () => {
      const current = this.rooms.get(roomId)
      if (!current) return
      const now = this.now()
      let changed = false

      const unexpiredReactions = current.reactions.filter((reaction) => reaction.expiresAt > now)
      if (unexpiredReactions.length !== current.reactions.length) {
        current.reactions = unexpiredReactions
        changed = true
      }

      for (const member of [...current.members]) {
        if (member.disconnectedAt === null || now - member.disconnectedAt < this.disconnectGraceMs) continue
        if (!current.game) {
          current.members = current.members.filter((candidate) => candidate.userId !== member.userId)
          this.userRooms.delete(member.userId)
          if (current.hostPlayerId === member.userId) current.hostPlayerId = current.members[0]?.userId ?? null
          current.revision += 1
          changed = true
          for (const listener of this.userRemovedListeners) listener(member.userId, current.id, "expired")
        } else {
          const result = applyGameCommand(current.game, {
            type: "convert_to_bot",
            playerId: member.userId,
            canReconnect: true,
            now,
          })
          if (result.ok && result.changed) {
            current.game = result.state
            current.revision = result.state.version
            changed = true
          }
        }
      }

      if (current.members.length === 0) {
        await this.deleteRoom(current, "empty")
        return
      }

      if (current.game) {
        const result = applyGameCommand(current.game, { type: "tick", now }, this.random)
        if (result.ok && result.changed) {
          current.game = result.state
          current.revision = result.state.version
          current.status = result.state.phase === "series_end" ? "finished" : "in_progress"
          changed = true
        }
      }

      const noConnections = current.members.every((member) => member.activeSocketIds.length === 0)
      if (noConnections && now - current.updatedAt >= this.idleRoomTtlMs) {
        await this.deleteRoom(current, "expired")
        return
      }

      if (changed) {
        current.updatedAt = now
        await this.store.save(current)
        this.notifyUpdated(current.id)
      }
    })
  }

  private async applyPlayerCommand(
    userId: string,
    commandId: string,
    apply: (room: PersistedRoom) => ReturnType<typeof applyGameCommand>,
  ): Promise<PublicGameSnapshot> {
    const roomId = this.requireUserRoomId(userId)
    return this.withRoomLock(roomId, async () => {
      const room = this.requireRoom(roomId)
      this.requireMember(room, userId)
      if (!room.game) throw new GameServerError("INVALID_PHASE", "The game has not started")
      if (this.isDuplicate(room, commandId)) return this.snapshot(room, userId)

      const result = apply(room)
      if (!result.ok) {
        throw new GameServerError(result.error.code, result.error.message, result.error.code === "CONFLICT")
      }
      if (result.changed) {
        room.game = result.state
        room.revision = result.state.version
        room.status = result.state.phase === "series_end" ? "finished" : "in_progress"
      }
      this.rememberCommand(room, commandId)
      room.updatedAt = this.now()
      await this.store.save(room)
      this.notifyUpdated(room.id)
      return this.snapshot(room, userId)
    })
  }

  private startGame(room: PersistedRoom, now: number): void {
    const players: EnginePlayerInput[] = room.members.map((member) => ({
      id: member.userId,
      displayName: member.displayName,
      avatarSeed: member.avatarSeed,
      isBot: false,
      canReconnect: true,
      isConnected: member.activeSocketIds.length > 0,
    }))
    while (players.length < room.maxPlayers) {
      const botNumber = players.filter((player) => player.isBot).length + 1
      players.push({
        id: `bot-${this.random.id(10)}`,
        displayName: `Keeper ${botNumber}`,
        avatarSeed: `keeper-${this.random.id(6)}`,
        isBot: true,
        canReconnect: false,
        isConnected: false,
      })
    }
    room.game = createGame(
      {
        gameId: room.id,
        players,
        roundsToWin: room.roundsToWin,
        now,
        initialVersion: room.revision + 1,
        config: this.engineConfig,
      },
      this.random,
    )
    room.revision = room.game.version
    room.status = "in_progress"
    room.matchmakingDeadline = null
    if (room.code) this.codeRooms.delete(room.code)
  }

  private snapshot(room: PersistedRoom, userId: string): PublicGameSnapshot {
    const now = this.now()
    const reactions = room.reactions
      .filter((reaction) => reaction.expiresAt > now)
      .map((reaction) => ({ ...reaction }))
    if (room.game) {
      return projectGameState(room.game, {
        viewerPlayerId: userId,
        roomCode: room.code,
        isPrivate: room.isPrivate,
        hostPlayerId: room.hostPlayerId,
        maxPlayers: room.maxPlayers,
        serverTime: now,
        reactions,
      })
    }

    return {
      protocolVersion: PROTOCOL_VERSION,
      roomId: room.id,
      roomCode: room.code,
      status: "waiting",
      isPrivate: room.isPrivate,
      hostPlayerId: room.hostPlayerId,
      selfPlayerId: userId,
      maxPlayers: room.maxPlayers,
      roundsToWin: room.roundsToWin,
      version: room.revision,
      serverTime: now,
      players: room.members.map((member) => ({
        id: member.userId,
        displayName: member.displayName,
        avatarSeed: member.avatarSeed,
        isBot: false,
        isConnected: member.activeSocketIds.length > 0,
        isEliminated: false,
        seriesWins: 0,
        isHost: member.userId === room.hostPlayerId,
      })),
      cards: [],
      phase: "waiting",
      currentPlayerId: null,
      targetPlayerId: null,
      pendingEliminationId: null,
      turnId: null,
      deadline: room.matchmakingDeadline,
      currentRound: 1,
      roundWinnerId: null,
      seriesWinnerId: null,
      lastMessage: room.isPrivate ? "Waiting for the host to start." : "Searching for players.",
      rematchVotes: [],
      reactions,
      canAct: false,
      canStart: room.hostPlayerId === userId,
      canVoteRematch: false,
    }
  }

  private createMember(identity: SessionIdentity, socketId: string): RoomMember {
    return {
      userId: identity.userId,
      displayName: identity.displayName,
      avatarSeed: identity.avatarSeed,
      activeSocketIds: [socketId],
      disconnectedAt: null,
      joinedAt: this.now(),
    }
  }

  private validateRestoredRoom(room: PersistedRoom): string[] {
    const errors: string[] = []
    const memberIds = room.members.map((member) => member.userId)
    if (new Set(memberIds).size !== memberIds.length) errors.push("room member IDs must be unique")
    if (room.members.length > room.maxPlayers) errors.push("room has more members than its configured capacity")
    if (room.hostPlayerId !== null && !memberIds.includes(room.hostPlayerId)) {
      errors.push("room host must be a current member")
    }
    if (room.isPrivate !== Boolean(room.code)) errors.push("private room/code state is inconsistent")
    if (new Set(room.processedCommandIds).size !== room.processedCommandIds.length) {
      errors.push("processed command IDs must be unique")
    }

    if (!room.game) {
      if (room.status !== "waiting") errors.push("a room without a game must be waiting")
      if (room.isPrivate && room.matchmakingDeadline !== null) {
        errors.push("private waiting rooms cannot have a matchmaking deadline")
      }
      if (!room.isPrivate && room.matchmakingDeadline === null) {
        errors.push("public waiting rooms require a matchmaking deadline")
      }
      return errors
    }

    if (room.matchmakingDeadline !== null) errors.push("started games cannot have a matchmaking deadline")
    if (room.game.gameId !== room.id) errors.push("game ID must match room ID")
    if (room.game.version !== room.revision) errors.push("room revision must match game version")
    if (room.game.roundsToWin !== room.roundsToWin) errors.push("room and game round settings must match")
    if (room.game.players.length !== room.maxPlayers) errors.push("started games must contain the configured player count")
    const gamePlayerIds = new Set(room.game.players.map((player) => player.id))
    if (memberIds.some((memberId) => !gamePlayerIds.has(memberId))) {
      errors.push("every room member must exist in the game")
    }
    const expectedStatus = room.game.phase === "series_end" ? "finished" : "in_progress"
    if (room.status !== expectedStatus) errors.push("room status must match the game phase")

    try {
      errors.push(...validateGameState(room.game))
    } catch {
      errors.push("game state could not be validated")
    }
    return errors
  }

  private uniqueRoomCode(): string {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      let code = ""
      for (let index = 0; index < 6; index += 1) {
        code += ROOM_CODE_ALPHABET[this.random.integer(ROOM_CODE_ALPHABET.length)]
      }
      if (!this.codeRooms.has(code)) return code
    }
    throw new GameServerError("INTERNAL_ERROR", "Could not allocate a private room code", true)
  }

  private requireRoom(roomId: string): PersistedRoom {
    const room = this.rooms.get(roomId)
    if (!room) throw new GameServerError("ROOM_NOT_FOUND", "Room not found")
    return room
  }

  private requireUserRoomId(userId: string): string {
    const roomId = this.userRooms.get(userId)
    if (!roomId) throw new GameServerError("NOT_IN_ROOM", "Join a room first")
    return roomId
  }

  private requireMember(room: PersistedRoom, userId: string): RoomMember {
    const member = room.members.find((candidate) => candidate.userId === userId)
    if (!member) throw new GameServerError("NOT_IN_ROOM", "This session is not a member of the room")
    return member
  }

  private async existingSnapshot(userId: string): Promise<PublicGameSnapshot | null> {
    const roomId = this.userRooms.get(userId)
    if (!roomId) return null
    const room = this.rooms.get(roomId)
    if (!room || !room.members.some((member) => member.userId === userId)) {
      this.userRooms.delete(userId)
      return null
    }
    return this.snapshot(room, userId)
  }

  private isDuplicate(room: PersistedRoom, commandId: string): boolean {
    return room.processedCommandIds.includes(commandId)
  }

  private rememberCommand(room: PersistedRoom, commandId: string): void {
    if (!room.processedCommandIds.includes(commandId)) room.processedCommandIds.push(commandId)
    if (room.processedCommandIds.length > MAX_PROCESSED_COMMANDS) {
      room.processedCommandIds.splice(0, room.processedCommandIds.length - MAX_PROCESSED_COMMANDS)
    }
  }

  private async deleteRoom(
    room: PersistedRoom,
    reason: "empty" | "expired" | "server_shutdown",
  ): Promise<void> {
    this.rooms.delete(room.id)
    if (room.code) this.codeRooms.delete(room.code)
    for (const member of room.members) {
      this.userRooms.delete(member.userId)
      for (const listener of this.userRemovedListeners) listener(member.userId, room.id, "expired")
    }
    await this.store.delete(room.id)
    for (const listener of this.closedListeners) listener(room.id, reason)
  }

  private notifyUpdated(roomId: string): void {
    for (const listener of this.updateListeners) listener(roomId)
  }

  private async withGlobalLock<T>(task: () => Promise<T>): Promise<T> {
    return this.withLock("__global__", task)
  }

  private async withRoomLock<T>(roomId: string, task: () => Promise<T>): Promise<T> {
    return this.withLock(`room:${roomId}`, task)
  }

  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queueTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate)
    this.queueTails.set(key, tail)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.queueTails.get(key) === tail) this.queueTails.delete(key)
    }
  }
}
