import { afterEach, describe, expect, it, vi } from "vitest"

import type { PublicGameSnapshot } from "../../shared/protocol"
import type { GameClientState } from "./game-types"
import { GameClient, mapGameSnapshot, shouldApplySnapshot } from "./game-client"

function snapshot(roomId: string, version: number): PublicGameSnapshot {
  return { roomId, version } as PublicGameSnapshot
}

describe("multiplayer snapshot ordering", () => {
  it("accepts the first snapshot and monotonic updates for its room", () => {
    expect(shouldApplySnapshot(undefined, snapshot("room-a", 2))).toBe(true)
    expect(shouldApplySnapshot(snapshot("room-a", 2), snapshot("room-a", 2))).toBe(true)
    expect(shouldApplySnapshot(snapshot("room-a", 2), snapshot("room-a", 3))).toBe(true)
  })

  it("ignores stale acknowledgements, older versions, and cross-room deliveries", () => {
    expect(shouldApplySnapshot(snapshot("room-a", 3), snapshot("room-a", 3), "ack")).toBe(false)
    expect(shouldApplySnapshot(snapshot("room-a", 3), snapshot("room-a", 2))).toBe(false)
    expect(shouldApplySnapshot(snapshot("room-a", 3), snapshot("room-b", 4))).toBe(false)
  })
})

describe("multiplayer presentation mapping", () => {
  afterEach(() => vi.restoreAllMocks())

  function gameSnapshot(
    phase: PublicGameSnapshot["phase"],
    canAct: boolean,
    overrides: Partial<PublicGameSnapshot> = {},
  ): PublicGameSnapshot {
    return {
      protocolVersion: 1,
      roomId: "room-a",
      roomCode: null,
      status: "in_progress",
      isPrivate: false,
      hostPlayerId: "player-1",
      selfPlayerId: "player-1",
      maxPlayers: 4,
      roundsToWin: 1,
      version: 2,
      serverTime: 1_000,
      players: [
        {
          id: "player-1",
          displayName: "Player One",
          avatarSeed: "lyra",
          isBot: false,
          isConnected: true,
          isEliminated: false,
          seriesWins: 0,
          isHost: true,
        },
        {
          id: "player-2",
          displayName: "Player Two",
          avatarSeed: "rowan",
          isBot: false,
          isConnected: true,
          isEliminated: false,
          seriesWins: 0,
          isHost: false,
        },
      ],
      cards: [],
      phase,
      currentPlayerId: "player-1",
      targetPlayerId: null,
      pendingEliminationId: null,
      turnId: "turn-1",
      deadline: 16_000,
      currentRound: 1,
      roundWinnerId: null,
      seriesWinnerId: null,
      lastMessage: `${phase} message`,
      rematchVotes: [],
      reactions: [],
      canAct,
      canStart: false,
      canVoteRematch: false,
      ...overrides,
    }
  }

  it("exposes countdown data only for the local player's actionable phases", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)

    expect(mapGameSnapshot(gameSnapshot("select_target", true), 0)).toMatchObject({
      phase: "select_target",
      turnDeadlineAt: 16_000,
      turnDurationMs: 15_000,
    })
    expect(mapGameSnapshot(gameSnapshot("select_target", false), 0).turnDeadlineAt).toBeUndefined()
    expect(mapGameSnapshot(gameSnapshot("reveal_result", false), 0).turnDeadlineAt).toBeUndefined()
  })

  it("maps authoritative starting and shuffling phases without turn cues", () => {
    expect(mapGameSnapshot(gameSnapshot("starting", false), 0)).toMatchObject({
      phase: "starting",
      lastEvent: { kind: "round" },
    })
    expect(mapGameSnapshot(gameSnapshot("shuffling", false), 0)).toMatchObject({
      phase: "shuffling",
      lastEvent: { kind: "shuffle" },
    })
  })
})

describe("local multiplayer recovery", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("lets an offline player abandon a cached room", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      localStorage: { removeItem: vi.fn() },
    })
    vi.stubGlobal("document", { addEventListener: vi.fn() })

    const client = new GameClient()
    const internal = client as unknown as { state: GameClientState }
    internal.state = {
      connection: "offline",
      lobby: {
        id: "room-a",
        mode: "quick",
        players: [],
        maxPlayers: 4,
        roundsToWin: 2,
        status: "waiting",
      },
    }

    const leaving = client.leaveLobby()
    expect(client.getSnapshot().lobby).toBeUndefined()
    await expect(leaving).resolves.toBe(true)
    expect(client.getSnapshot()).toMatchObject({ connection: "offline" })
    expect(client.getSnapshot().lobby).toBeUndefined()
    expect(client.getSnapshot().game).toBeUndefined()
  })

  it("orders an authoritative leave before closing a cancelled join socket", () => {
    const removeItem = vi.fn()
    vi.stubGlobal("navigator", { onLine: true })
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      localStorage: { removeItem },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    vi.stubGlobal("document", { addEventListener: vi.fn() })

    const disconnect = vi.fn()
    const emit = vi.fn((event: string, _input: unknown, acknowledge: () => void) => {
      expect(event).toBe("room:leave")
      acknowledge()
    })
    const client = new GameClient()
    const internal = client as unknown as {
      socket: { connected: boolean; emit: typeof emit; disconnect: typeof disconnect }
      state: GameClientState
    }
    internal.socket = { connected: true, emit, disconnect }
    internal.state = {
      connection: "connected",
      lobby: {
        id: "room-a",
        mode: "quick",
        players: [],
        maxPlayers: 4,
        roundsToWin: 2,
        status: "waiting",
      },
    }

    client.cancelPendingJoin()

    expect(emit).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(removeItem).toHaveBeenCalledOnce()
    expect(client.getSnapshot()).toMatchObject({ connection: "idle" })
    expect(client.getSnapshot().lobby).toBeUndefined()
  })

  it("does not resume a queued join after it is cancelled during a slow leave", async () => {
    const fetchSession = vi.fn()
    vi.stubGlobal("fetch", fetchSession)
    vi.stubGlobal("navigator", { onLine: true })
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      localStorage: { removeItem: vi.fn() },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    vi.stubGlobal("document", { addEventListener: vi.fn() })

    let finishLeave!: (accepted: boolean) => void
    const slowLeave = new Promise<boolean>((resolve) => {
      finishLeave = resolve
    })
    const client = new GameClient()
    const internal = client as unknown as { leavePromise: Promise<boolean> }
    internal.leavePromise = slowLeave

    const joining = client.joinQuick(
      { id: "local-player", displayName: "Mira", avatarId: "mira" },
      { maxPlayers: 4, roundsToWin: 2 },
    )
    await Promise.resolve()
    client.cancelPendingJoin()
    finishLeave(true)

    await expect(joining).resolves.toBe(false)
    expect(fetchSession).not.toHaveBeenCalled()
    expect(client.getSnapshot()).toMatchObject({ connection: "idle" })
  })
})
