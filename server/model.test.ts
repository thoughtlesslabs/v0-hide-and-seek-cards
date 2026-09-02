import { describe, expect, it } from "vitest"

import { DEFAULT_ENGINE_CONFIG, createGame } from "../shared/game-engine"
import { parsePersistedRoom, type PersistedRoom } from "./model"

function validWaitingRoom(): PersistedRoom {
  return {
    schemaVersion: 1,
    id: "validated-room",
    code: "RSTR24",
    isPrivate: true,
    hostPlayerId: "player-1",
    status: "waiting",
    maxPlayers: 4,
    roundsToWin: 1,
    revision: 2,
    createdAt: 1,
    updatedAt: 2,
    matchmakingDeadline: null,
    members: [
      {
        userId: "player-1",
        displayName: "Player One",
        avatarSeed: "lyra",
        activeSocketIds: [],
        disconnectedAt: 2,
        joinedAt: 1,
      },
    ],
    game: null,
    reactions: [],
    processedCommandIds: ["create-command"],
  }
}

describe("persisted room schema", () => {
  it("accepts a complete version-one snapshot", () => {
    expect(parsePersistedRoom(validWaitingRoom())).toEqual(validWaitingRoom())
  })

  it("rejects missing and unexpected room fields", () => {
    const missingCommands = { ...validWaitingRoom() } as Partial<PersistedRoom>
    delete missingCommands.processedCommandIds
    expect(parsePersistedRoom(missingCommands)).toBeNull()
    expect(parsePersistedRoom({ ...validWaitingRoom(), unexpected: true })).toBeNull()
  })

  it("rejects malformed nested game and transport state", () => {
    expect(parsePersistedRoom({ ...validWaitingRoom(), game: { gameId: "partial" } })).toBeNull()
    const tooManySockets = validWaitingRoom()
    tooManySockets.members[0]!.activeSocketIds = Array.from({ length: 33 }, (_, index) => `socket-${index}`)
    expect(parsePersistedRoom(tooManySockets)).toBeNull()
  })

  it("strips the retired reveal-history field from existing game snapshots", () => {
    const room = validWaitingRoom()
    room.status = "in_progress"
    room.game = createGame({
      gameId: room.id,
      players: [
        { id: "player-1", displayName: "Player One", avatarSeed: "lyra" },
        { id: "player-2", displayName: "Player Two", avatarSeed: "rowan" },
      ],
      roundsToWin: 1,
      now: 1,
    })
    Object.assign(room.game.players[0], {
      observedCards: [{ position: 0, ownerId: room.game.cards[0].ownerId }],
    })

    const parsed = parsePersistedRoom(room)

    expect(parsed?.game?.players[0]).not.toHaveProperty("observedCards")
  })

  it("adds presentation durations while loading older game snapshots", () => {
    const room = validWaitingRoom()
    room.status = "in_progress"
    room.game = createGame({
      gameId: room.id,
      players: [
        { id: "player-1", displayName: "Player One", avatarSeed: "lyra" },
        { id: "player-2", displayName: "Player Two", avatarSeed: "rowan" },
      ],
      roundsToWin: 1,
      now: 1,
    })
    const legacyConfig = room.game.config as Partial<typeof room.game.config>
    delete legacyConfig.startDurationMs
    delete legacyConfig.shuffleDurationMs

    const parsed = parsePersistedRoom(room)

    expect(parsed?.game?.config).toMatchObject({
      startDurationMs: DEFAULT_ENGINE_CONFIG.startDurationMs,
      shuffleDurationMs: DEFAULT_ENGINE_CONFIG.shuffleDurationMs,
    })

    legacyConfig.shuffleDurationMs = 0
    expect(parsePersistedRoom(room)).toBeNull()
    delete legacyConfig.shuffleDurationMs
    Object.assign(legacyConfig, { unexpectedDurationMs: 500 })
    expect(parsePersistedRoom(room)).toBeNull()
  })
})
