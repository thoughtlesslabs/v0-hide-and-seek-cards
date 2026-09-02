import { describe, expect, it, vi } from "vitest"

import type { RandomSource } from "../shared/game-engine"
import { GameServerError } from "./errors"
import type { PersistedRoom, SessionIdentity } from "./model"
import { RoomManager } from "./room-manager"
import type { SnapshotStore } from "./snapshot-store"

class DeterministicRandom implements RandomSource {
  private idValue = 0
  private integerValue = 0

  integer(maxExclusive: number): number {
    const result = this.integerValue % maxExclusive
    this.integerValue += 1
    return result
  }

  id(bytes = 18): string {
    this.idValue += 1
    return this.idValue.toString(16).padStart(bytes * 2, "0")
  }
}

class RecordingSnapshotStore implements SnapshotStore {
  readonly kind = "recording-memory"
  readonly rooms = new Map<string, PersistedRoom>()
  saveCalls = 0

  async loadAll(): Promise<PersistedRoom[]> {
    return [...this.rooms.values()].map((room) => structuredClone(room))
  }

  async save(room: PersistedRoom): Promise<void> {
    this.saveCalls += 1
    this.rooms.set(room.id, structuredClone(room))
  }

  async delete(roomId: string): Promise<void> {
    this.rooms.delete(roomId)
  }

  get(roomId: string): PersistedRoom {
    const room = this.rooms.get(roomId)
    if (!room) throw new Error(`Missing recorded room ${roomId}`)
    return structuredClone(room)
  }
}

class RecoveringSnapshotStore implements SnapshotStore {
  kind = "memory-fallback"
  readonly persistedRooms = new Map<string, PersistedRoom>()
  readonly memoryRooms = new Map<string, PersistedRoom>()
  available = false
  loadCalls = 0

  async loadAll(): Promise<PersistedRoom[]> {
    this.loadCalls += 1
    if (!this.available) {
      this.kind = "memory-fallback"
      return [...this.memoryRooms.values()].map((room) => structuredClone(room))
    }

    this.kind = "redis"
    const merged = new Map(this.persistedRooms)
    for (const [roomId, room] of this.memoryRooms) merged.set(roomId, room)
    return [...merged.values()].map((room) => structuredClone(room))
  }

  async save(room: PersistedRoom): Promise<void> {
    this.memoryRooms.set(room.id, structuredClone(room))
    if (this.available) this.persistedRooms.set(room.id, structuredClone(room))
    else this.kind = "memory-fallback"
  }

  async delete(roomId: string): Promise<void> {
    this.memoryRooms.delete(roomId)
    if (this.available) this.persistedRooms.delete(roomId)
    else this.kind = "memory-fallback"
  }
}

const avatarSeeds = ["lyra", "rowan", "mira", "orin"]

function identity(index: number): SessionIdentity {
  return {
    userId: `player-${index + 1}`,
    displayName: `Player ${index + 1}`,
    avatarSeed: avatarSeeds[index] ?? "lyra",
    tokenId: `token-${index + 1}`,
    issuedAt: 1,
    expiresAt: 100_000,
  }
}

function persistedWaitingRoom(
  id: string,
  member: SessionIdentity,
  updatedAt = 500,
): PersistedRoom {
  return {
    schemaVersion: 1,
    id,
    code: "RSTR24",
    isPrivate: true,
    hostPlayerId: member.userId,
    status: "waiting",
    maxPlayers: 4,
    roundsToWin: 1,
    revision: 3,
    createdAt: 100,
    updatedAt,
    matchmakingDeadline: null,
    members: [
      {
        userId: member.userId,
        displayName: member.displayName,
        avatarSeed: member.avatarSeed,
        activeSocketIds: ["socket-before-outage"],
        disconnectedAt: null,
        joinedAt: 100,
      },
    ],
    game: null,
    reactions: [],
    processedCommandIds: ["persisted-create-command"],
  }
}

function createHarness(store = new RecordingSnapshotStore(), initialNow = 1_000) {
  let now = initialNow
  const manager = new RoomManager({
    store,
    random: new DeterministicRandom(),
    now: () => now,
    disconnectGraceMs: 50,
    idleRoomTtlMs: 1_000_000,
    engineConfig: {
      startDurationMs: 1,
      turnDurationMs: 100_000,
      botThinkDurationMs: 100_000,
      revealDurationMs: 100_000,
      shuffleDurationMs: 100_000,
      eliminationDurationMs: 100_000,
      roundEndDurationMs: 100_000,
    },
  })

  return {
    manager,
    store,
    advance(milliseconds: number) {
      now += milliseconds
    },
  }
}

type Harness = ReturnType<typeof createHarness>

async function startFourPlayerPrivateGame(harness: Harness) {
  const identities = Array.from({ length: 4 }, (_, index) => identity(index))
  const sockets = identities.map((_, index) => `socket-${index + 1}`)
  const created = await harness.manager.createPrivateRoom(identities[0], sockets[0], {
    commandId: "create-room-0001",
    maxPlayers: 4,
    roundsToWin: 1,
  })
  if (!created.roomCode) throw new Error("Private room did not receive a room code")

  for (let index = 1; index < identities.length; index += 1) {
    await harness.manager.joinPrivateRoom(identities[index], sockets[index], {
      commandId: `join-room-000${index}`,
      roomCode: created.roomCode,
    })
  }

  await harness.manager.startHostedGame(identities[0].userId, "start-game-0001")
  harness.advance(1)
  await harness.manager.tick()
  const started = await harness.manager.sync(identities[0].userId)
  return { identities, sockets, created, started }
}

describe("RoomManager snapshot recovery", () => {
  it("discards one malformed snapshot without failing recovery of the process", async () => {
    const store = new RecordingSnapshotStore()
    const malformed = persistedWaitingRoom("malformed-room", identity(0)) as Partial<PersistedRoom> & { id: string }
    delete malformed.processedCommandIds
    store.rooms.set(malformed.id, malformed as PersistedRoom)
    const warnings = vi.fn()
    const manager = new RoomManager({ store, warn: warnings })

    await expect(manager.initialize()).resolves.toBeUndefined()

    expect(manager.stats().rooms).toBe(0)
    expect(store.rooms.has(malformed.id)).toBe(false)
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining("Discarding malformed room snapshot"))
  })

  it("discards structurally valid snapshots whose room invariants conflict", async () => {
    const store = new RecordingSnapshotStore()
    const invalid = persistedWaitingRoom("duplicate-member-room", identity(0))
    invalid.members.push(structuredClone(invalid.members[0]!))
    store.rooms.set(invalid.id, invalid)
    const warnings = vi.fn()
    const manager = new RoomManager({ store, warn: warnings })

    await expect(manager.initialize()).resolves.toBeUndefined()

    expect(manager.stats().rooms).toBe(0)
    expect(store.rooms.has(invalid.id)).toBe(false)
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining("room member IDs must be unique"))
  })

  it("rehydrates rooms when Redis returns after a cold-start outage", async () => {
    const store = new RecoveringSnapshotStore()
    const persisted = persistedWaitingRoom("persisted-room", identity(0))
    store.persistedRooms.set(persisted.id, persisted)
    const warnings = vi.fn()
    const manager = new RoomManager({
      store,
      random: new DeterministicRandom(),
      now: () => 1_000,
      warn: warnings,
    })

    await manager.initialize()
    expect(manager.stats()).toMatchObject({ rooms: 0, snapshotStore: "memory-fallback" })

    store.available = true
    await expect(manager.recoverSnapshots()).resolves.toEqual([persisted.id])

    expect(manager.stats()).toMatchObject({ rooms: 1, snapshotStore: "redis" })
    expect(manager.roomIdForUser(identity(0).userId)).toBe(persisted.id)
    expect(await manager.resume(identity(0), "socket-after-recovery")).toMatchObject({
      roomId: persisted.id,
      selfPlayerId: identity(0).userId,
    })
    expect(warnings).not.toHaveBeenCalled()
  })

  it("keeps a newer local room when a recovered snapshot has a conflicting member", async () => {
    const store = new RecoveringSnapshotStore()
    const player = identity(0)
    const persisted = persistedWaitingRoom("stale-persisted-room", player, 500)
    store.persistedRooms.set(persisted.id, persisted)
    const warnings = vi.fn()
    const manager = new RoomManager({
      store,
      random: new DeterministicRandom(),
      now: () => 2_000,
      warn: warnings,
    })
    await manager.initialize()
    const local = await manager.createPrivateRoom(player, "socket-local", {
      commandId: "local-create-command",
      maxPlayers: 4,
      roundsToWin: 1,
    })

    store.available = true
    await expect(manager.recoverSnapshots()).resolves.toEqual([])

    expect(manager.stats().rooms).toBe(1)
    expect(manager.roomIdForUser(player.userId)).toBe(local.roomId)
    expect(manager.snapshotForRoom(persisted.id, player.userId)).toBeNull()
    expect(warnings).toHaveBeenCalledWith(
      expect.stringContaining(`Skipping recovered room ${persisted.id}`),
    )
  })
})

describe("RoomManager authoritative private rooms", () => {
  it("bounds concurrent sockets for one player card", async () => {
    const store = new RecordingSnapshotStore()
    const manager = new RoomManager({ store, maxSocketsPerUser: 2 })
    const player = identity(0)
    await manager.createPrivateRoom(player, "socket-1", {
      commandId: "create-socket-limit-room",
      maxPlayers: 4,
      roundsToWin: 1,
    })

    await expect(manager.resume(player, "socket-2")).resolves.toMatchObject({ selfPlayerId: player.userId })
    await expect(manager.resume(player, "socket-3")).rejects.toEqual(
      expect.objectContaining<Partial<GameServerError>>({ code: "RATE_LIMITED", retryable: true }),
    )
  })

  it("enforces host-only starts and projects no server-only card ownership", async () => {
    const harness = createHarness()
    const host = identity(0)
    const guest = identity(1)
    const created = await harness.manager.createPrivateRoom(host, "socket-host", {
      commandId: "create-room-0001",
      maxPlayers: 4,
      roundsToWin: 2,
    })

    expect(created).toMatchObject({
      status: "waiting",
      isPrivate: true,
      hostPlayerId: host.userId,
      selfPlayerId: host.userId,
      canStart: true,
    })
    expect(created.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)

    const joined = await harness.manager.joinPrivateRoom(guest, "socket-guest", {
      commandId: "join-room-0001",
      roomCode: created.roomCode!,
    })
    expect(joined.players.map((player) => player.id)).toEqual([host.userId, guest.userId])
    expect(joined.canStart).toBe(false)

    await expect(harness.manager.startHostedGame(guest.userId, "start-game-guest")).rejects.toEqual(
      expect.objectContaining<Partial<GameServerError>>({ code: "NOT_HOST", retryable: false }),
    )

    for (let index = 2; index < 4; index += 1) {
      const player = identity(index)
      await harness.manager.joinPrivateRoom(player, `socket-${index + 1}`, {
        commandId: `join-room-000${index}`,
        roomCode: created.roomCode!,
      })
    }

    const started = await harness.manager.startHostedGame(host.userId, "start-game-host")
    expect(started).toMatchObject({ status: "in_progress", phase: "starting", canStart: false })
    expect(started.players).toHaveLength(4)
    expect(started.players.every((player) => !player.isBot)).toBe(true)
    expect(started.cards).toHaveLength(4)
    for (const card of started.cards) {
      expect(Object.keys(card).sort()).toEqual(["isRevealed", "position", "revealedOwnerId", "token"])
      expect(card.revealedOwnerId).toBeNull()
    }

    const privateRoom = harness.store.get(started.roomId)
    expect(privateRoom.game?.cards.every((card) => card.ownerId.length > 0)).toBe(true)
    expect(JSON.stringify(started)).not.toContain('"ownerId"')
    expect(JSON.stringify(started)).not.toContain('"secretId"')
    expect(JSON.stringify(started)).not.toContain('"selectedCardSecretId"')
  })

  it("lets a private host fill every empty seat with house bots", async () => {
    const harness = createHarness()
    const host = identity(0)
    await harness.manager.createPrivateRoom(host, "socket-host", {
      commandId: "create-bot-room",
      maxPlayers: 4,
      roundsToWin: 2,
    })

    const started = await harness.manager.startHostedGame(host.userId, "start-with-bots")

    expect(started).toMatchObject({ status: "in_progress", phase: "starting" })
    expect(started.players).toHaveLength(4)
    expect(started.players.filter((player) => player.isBot)).toHaveLength(3)
    expect(started.players.find((player) => player.id === host.userId)?.isBot).toBe(false)
  })

  it("serializes concurrent duplicate commands and applies them exactly once", async () => {
    const harness = createHarness()
    const { identities, started } = await startFourPlayerPrivateGame(harness)
    const actor = identities.find((player) => player.userId === started.currentPlayerId)!
    const target = identities.find((player) => player.userId !== actor.userId)!
    const updates = vi.fn()
    harness.manager.onRoomUpdated(updates)
    const savesBeforeCommand = harness.store.saveCalls
    const input = {
      commandId: "select-target-once",
      expectedVersion: started.version,
      turnId: started.turnId!,
      targetPlayerId: target.userId,
    }

    const [first, retry] = await Promise.all([
      harness.manager.selectTarget(actor.userId, input),
      harness.manager.selectTarget(actor.userId, input),
    ])

    expect(first).toMatchObject({
      phase: "select_card",
      targetPlayerId: target.userId,
      version: started.version + 1,
    })
    expect(retry).toMatchObject({
      phase: first.phase,
      targetPlayerId: first.targetPlayerId,
      version: first.version,
    })
    expect(harness.store.saveCalls).toBe(savesBeforeCommand + 1)
    expect(updates).toHaveBeenCalledOnce()
    expect(
      harness.store
        .get(started.roomId)
        .processedCommandIds.filter((commandId) => commandId === input.commandId),
    ).toHaveLength(1)
  })

  it("moves every card after a miss and sends every player the same new layout", async () => {
    const harness = createHarness()
    const { identities, started } = await startFourPlayerPrivateGame(harness)
    const actor = identities.find((player) => player.userId === started.currentPlayerId)!
    const target = identities.find((player) => player.userId !== actor.userId)!
    const privateGame = harness.store.get(started.roomId).game!
    const missCard = privateGame.cards.find(
      (card) => card.ownerId !== actor.userId && card.ownerId !== target.userId,
    )!
    const oldPositions = new Map(privateGame.cards.map((card) => [card.ownerId, card.position]))
    const oldTokens = new Set(privateGame.cards.map((card) => card.selectionToken))

    const targeted = await harness.manager.selectTarget(actor.userId, {
      commandId: "move-after-miss-target",
      expectedVersion: started.version,
      turnId: started.turnId!,
      targetPlayerId: target.userId,
    })
    const revealed = await harness.manager.pickCard(actor.userId, {
      commandId: "move-after-miss-pick",
      expectedVersion: targeted.version,
      turnId: targeted.turnId!,
      cardToken: missCard.selectionToken,
    })
    expect(revealed).toMatchObject({ phase: "reveal_result", pendingEliminationId: null })

    harness.advance(100_001)
    await harness.manager.tick()

    const shuffled = await harness.manager.sync(actor.userId)
    expect(shuffled.phase).toBe("shuffling")
    expect(shuffled.currentPlayerId).toBe(actor.userId)

    harness.advance(100_000)
    await harness.manager.tick()

    const nextTurn = await harness.manager.sync(actor.userId)
    const observerView = await harness.manager.sync(target.userId)
    const movedGame = harness.store.get(started.roomId).game!
    expect(nextTurn.phase).toBe("select_target")
    expect(nextTurn.currentPlayerId).not.toBe(actor.userId)
    expect(movedGame.cards.every((card) => card.position !== oldPositions.get(card.ownerId))).toBe(true)
    expect(movedGame.cards.every((card) => !oldTokens.has(card.selectionToken))).toBe(true)
    expect(observerView.cards).toEqual(nextTurn.cards)
  })

  it("converts a disconnected player after grace and lets the same session reclaim control", async () => {
    const harness = createHarness()
    const { identities, sockets, started } = await startFourPlayerPrivateGame(harness)
    const actor = identities.find((player) => player.userId === started.currentPlayerId)!
    const actorIndex = identities.findIndex((player) => player.userId === actor.userId)
    const observer = identities.find((player) => player.userId !== actor.userId)!

    await harness.manager.disconnect(actor.userId, sockets[actorIndex])
    const disconnected = await harness.manager.sync(observer.userId)
    expect(disconnected.players.find((player) => player.id === actor.userId)).toMatchObject({
      isConnected: false,
      isBot: false,
    })

    harness.advance(51)
    await harness.manager.tick()
    const botControlled = await harness.manager.sync(observer.userId)
    expect(botControlled.players.find((player) => player.id === actor.userId)).toMatchObject({
      isConnected: false,
      isBot: true,
    })

    const resumed = await harness.manager.resume(actor, "socket-reconnected")
    expect(resumed?.players.find((player) => player.id === actor.userId)).toMatchObject({
      isConnected: true,
      isBot: false,
    })
    expect(resumed?.canAct).toBe(true)
  })

  it("restores an active room after restart and preserves command deduplication", async () => {
    const firstProcess = createHarness()
    const { identities, started } = await startFourPlayerPrivateGame(firstProcess)
    const actor = identities.find((player) => player.userId === started.currentPlayerId)!
    const target = identities.find((player) => player.userId !== actor.userId)!
    const command = {
      commandId: "persisted-command",
      expectedVersion: started.version,
      turnId: started.turnId!,
      targetPlayerId: target.userId,
    }
    const selected = await firstProcess.manager.selectTarget(actor.userId, command)
    expect(selected.phase).toBe("select_card")

    const secondProcess = createHarness(firstProcess.store, 2_000)
    await secondProcess.manager.initialize()
    const resumed = await secondProcess.manager.resume(actor, "socket-after-restart")
    expect(resumed).toMatchObject({ roomId: started.roomId, phase: "select_card" })
    expect(resumed?.players.find((player) => player.id === actor.userId)?.isConnected).toBe(true)

    const savesBeforeRetry = firstProcess.store.saveCalls
    const retried = await secondProcess.manager.selectTarget(actor.userId, command)
    expect(retried).toMatchObject({ phase: "select_card", targetPlayerId: target.userId })
    expect(firstProcess.store.saveCalls).toBe(savesBeforeRetry)
    expect(JSON.stringify(retried)).not.toContain('"ownerId"')
    expect(JSON.stringify(retried)).not.toContain('"secretId"')
  })

  it("expires reactions at the TTL boundary and removes them from persistence", async () => {
    const harness = createHarness()
    const host = identity(0)
    const created = await harness.manager.createPrivateRoom(host, "socket-host", {
      commandId: "create-reaction-room",
      maxPlayers: 4,
      roundsToWin: 1,
    })
    const reacted = await harness.manager.addReaction(host.userId, "reaction-command", "👍")

    expect(reacted.reactions).toEqual([
      { playerId: host.userId, emoji: "👍", expiresAt: reacted.serverTime + 5_000 },
    ])
    harness.advance(4_999)
    expect((await harness.manager.sync(host.userId)).reactions).toHaveLength(1)

    harness.advance(1)
    await harness.manager.tick()
    expect((await harness.manager.sync(host.userId)).reactions).toEqual([])
    expect(harness.store.get(created.roomId).reactions).toEqual([])
  })

  it("transfers a waiting room to the next host and deletes it after the last player leaves", async () => {
    const harness = createHarness()
    const host = identity(0)
    const guest = identity(1)
    const created = await harness.manager.createPrivateRoom(host, "socket-host", {
      commandId: "create-transfer-room",
      maxPlayers: 4,
      roundsToWin: 1,
    })
    await harness.manager.joinPrivateRoom(guest, "socket-guest", {
      commandId: "join-transfer-room",
      roomCode: created.roomCode!,
    })
    const removed = vi.fn()
    const closed = vi.fn()
    harness.manager.onUserRemoved(removed)
    harness.manager.onRoomClosed(closed)

    const hostDeparture = await harness.manager.leave(host.userId, "host-leave-command")
    expect(hostDeparture).toMatchObject({ hostPlayerId: guest.userId, selfPlayerId: host.userId })
    expect(harness.manager.roomIdForUser(host.userId)).toBeNull()
    expect(await harness.manager.sync(guest.userId)).toMatchObject({
      hostPlayerId: guest.userId,
      canStart: true,
    })
    expect(removed).toHaveBeenCalledWith(host.userId, created.roomId, "left")

    await harness.manager.leave(guest.userId, "guest-leave-command")
    expect(harness.manager.stats().rooms).toBe(0)
    expect(harness.store.rooms.has(created.roomId)).toBe(false)
    expect(closed).toHaveBeenCalledWith(created.roomId, "empty")
  })
})

describe("RoomManager public matchmaking", () => {
  it("lets the Quick Match host invite house bots immediately", async () => {
    const harness = createHarness()
    const player = identity(0)
    const waiting = await harness.manager.joinMatchmaking(player, "socket-player", {
      commandId: "quick-bots-join",
      maxPlayers: 4,
      roundsToWin: 2,
    })

    expect(waiting).toMatchObject({ isPrivate: false, status: "waiting", canStart: true })
    const started = await harness.manager.startHostedGame(player.userId, "quick-bots-start")

    expect(started).toMatchObject({ isPrivate: false, status: "in_progress", phase: "starting" })
    expect(started.players).toHaveLength(4)
    expect(started.players.filter((candidate) => candidate.isBot)).toHaveLength(3)
  })

  it("starts at the matchmaking deadline and fills open seats with bots", async () => {
    const harness = createHarness()
    const player = identity(0)
    const waiting = await harness.manager.joinMatchmaking(player, "socket-player", {
      commandId: "matchmaking-command",
      maxPlayers: 4,
      roundsToWin: 1,
    })

    expect(waiting).toMatchObject({
      status: "waiting",
      isPrivate: false,
      roomCode: null,
      deadline: waiting.serverTime + 8_000,
    })
    expect(waiting.players).toHaveLength(1)

    harness.advance(7_999)
    await harness.manager.tick()
    expect((await harness.manager.sync(player.userId)).status).toBe("waiting")

    harness.advance(1)
    await harness.manager.tick()
    const started = await harness.manager.sync(player.userId)
    expect(started).toMatchObject({ status: "in_progress", phase: "starting" })
    expect(started.players).toHaveLength(4)
    expect(started.players.filter((candidate) => candidate.isBot)).toHaveLength(3)
    expect(started.players.find((candidate) => candidate.id === player.userId)).toMatchObject({
      isBot: false,
      isConnected: true,
    })
    expect(harness.manager.stats()).toMatchObject({ waitingRooms: 0, activeGames: 1 })

    harness.advance(1)
    await harness.manager.tick()
    expect((await harness.manager.sync(player.userId)).phase).toBe("select_target")
  })
})
