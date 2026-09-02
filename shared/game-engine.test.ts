import { describe, expect, it } from "vitest"

import {
  DEFAULT_ENGINE_CONFIG,
  applyGameCommand,
  createGame,
  projectGameState,
  validateGameState,
  type EnginePlayerInput,
  type PrivateGameState,
  type RandomSource,
} from "./game-engine"

class DeterministicRandom implements RandomSource {
  private value = 0

  integer(maxExclusive: number): number {
    const result = this.value % maxExclusive
    this.value += 1
    return result
  }

  id(bytes = 18): string {
    this.value += 1
    return `deterministic-${bytes}-${this.value.toString().padStart(6, "0")}`
  }
}

class SeededRandom implements RandomSource {
  private value: number
  private idValue = 0

  constructor(seed: number) {
    this.value = seed >>> 0
  }

  integer(maxExclusive: number): number {
    this.value = (Math.imul(this.value, 1_664_525) + 1_013_904_223) >>> 0
    return this.value % maxExclusive
  }

  id(bytes = 18): string {
    this.idValue += 1
    return `${this.value.toString(16)}-${this.idValue.toString(16)}`.padEnd(bytes * 2, "0")
  }
}

const players: EnginePlayerInput[] = ["lyra", "rowan", "mira", "orin"].map((name, index) => ({
  id: `player-${index + 1}`,
  displayName: name,
  avatarSeed: name,
  isConnected: true,
}))

function advanceStarting(state: PrivateGameState, random: RandomSource): PrivateGameState {
  if (state.phase !== "starting" || state.deadline === null) return state
  const started = applyGameCommand(state, { type: "tick", now: state.deadline }, random)
  if (!started.ok) throw new Error(started.error.message)
  return started.state
}

function newGame(random = new DeterministicRandom(), overrides: Partial<EnginePlayerInput>[] = []): PrivateGameState {
  return advanceStarting(createGame(
    {
      gameId: "test-room",
      players: players.map((player, index) => ({ ...player, ...overrides[index] })),
      roundsToWin: 1,
      now: 1_000,
      config: {
        turnDurationMs: 10,
        botThinkDurationMs: 5,
        revealDurationMs: 5,
        eliminationDurationMs: 5,
        roundEndDurationMs: 5,
      },
    },
    random,
  ), random)
}

function twoPlayerRoundStates(roundsToWin: 1 | 2 | 3): {
  selectTarget: PrivateGameState
  selectCard: PrivateGameState
  revealResult: PrivateGameState
  elimination: PrivateGameState
  terminal: PrivateGameState
} {
  const random = new DeterministicRandom()
  const selectTarget = advanceStarting(createGame(
    {
      gameId: `two-player-${roundsToWin}`,
      players: players.slice(0, 2),
      roundsToWin,
      now: 1_000,
      config: {
        turnDurationMs: 10,
        botThinkDurationMs: 5,
        revealDurationMs: 5,
        eliminationDurationMs: 5,
        roundEndDurationMs: 5,
      },
    },
    random,
  ), random)
  const target = selectTarget.players.find((player) => player.id !== selectTarget.currentPlayerId)!
  const targeted = applyGameCommand(selectTarget, {
    type: "select_target",
    playerId: selectTarget.currentPlayerId,
    targetPlayerId: target.id,
    expectedVersion: selectTarget.version,
    turnId: selectTarget.turnId,
    now: selectTarget.deadline! - 1,
  })
  if (!targeted.ok) throw new Error(targeted.error.message)
  const selectCard = targeted.state
  const targetCard = selectCard.cards.find((card) => card.ownerId === target.id)!
  const picked = applyGameCommand(selectCard, {
    type: "pick_card",
    playerId: selectCard.currentPlayerId,
    cardToken: targetCard.selectionToken,
    expectedVersion: selectCard.version,
    turnId: selectCard.turnId,
    now: selectCard.deadline! - 1,
  })
  if (!picked.ok) throw new Error(picked.error.message)
  const revealResult = picked.state
  const eliminated = applyGameCommand(
    revealResult,
    { type: "tick", now: revealResult.deadline! + 1 },
    random,
  )
  if (!eliminated.ok) throw new Error(eliminated.error.message)
  const elimination = eliminated.state
  const finished = applyGameCommand(
    elimination,
    { type: "tick", now: elimination.deadline! + 1 },
    random,
  )
  if (!finished.ok) throw new Error(finished.error.message)
  return { selectTarget, selectCard, revealResult, elimination, terminal: finished.state }
}

describe("authoritative game engine", () => {
  it("uses the approved production presentation durations", () => {
    expect(DEFAULT_ENGINE_CONFIG).toMatchObject({
      startDurationMs: 1_500,
      revealDurationMs: 2_250,
      shuffleDurationMs: 1_000,
      eliminationDurationMs: 1_750,
      roundEndDurationMs: 3_000,
    })
  })

  it("holds a newly created game in the starting phase", () => {
    const random = new DeterministicRandom()
    const createdAt = 1_000
    const state = createGame({ gameId: "starting", players, roundsToWin: 1, now: createdAt }, random)

    expect(state.phase).toBe("starting")
    expect(state.deadline).toBe(createdAt + DEFAULT_ENGINE_CONFIG.startDurationMs)
    const early = applyGameCommand(state, { type: "tick", now: state.deadline! - 1 }, random)
    expect(early).toEqual({ ok: true, state, changed: false })

    const started = applyGameCommand(state, { type: "tick", now: state.deadline! }, random)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.phase).toBe("select_target")
    expect(started.state.deadline).toBe(state.deadline! + DEFAULT_ENGINE_CONFIG.turnDurationMs)
  })

  it.each([
    { roundsToWin: 1 as const, nextPhase: "series_end" as const },
    { roundsToWin: 2 as const, nextPhase: "round_end" as const },
  ])("holds reveal and elimination presentation phases before $nextPhase", ({ roundsToWin, nextPhase }) => {
    const random = new DeterministicRandom()
    let state = advanceStarting(
      createGame({ gameId: `pacing-${roundsToWin}`, players: players.slice(0, 2), roundsToWin, now: 1_000 }, random),
      random,
    )
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const targeted = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 1,
    })
    expect(targeted.ok).toBe(true)
    if (!targeted.ok) return
    const pickedAt = targeted.state.deadline! - 1
    const targetCard = targeted.state.cards.find((card) => card.ownerId === target.id)!
    const picked = applyGameCommand(targeted.state, {
      type: "pick_card",
      playerId: targeted.state.currentPlayerId,
      cardToken: targetCard.selectionToken,
      expectedVersion: targeted.state.version,
      turnId: targeted.state.turnId,
      now: pickedAt,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok) return
    expect(picked.state.deadline).toBe(pickedAt + DEFAULT_ENGINE_CONFIG.revealDurationMs)

    const earlyReveal = applyGameCommand(picked.state, { type: "tick", now: picked.state.deadline! - 1 }, random)
    expect(earlyReveal).toEqual({ ok: true, state: picked.state, changed: false })
    const eliminatedAt = picked.state.deadline!
    const eliminating = applyGameCommand(picked.state, { type: "tick", now: eliminatedAt }, random)
    expect(eliminating.ok).toBe(true)
    if (!eliminating.ok) return
    expect(eliminating.state.phase).toBe("elimination")
    expect(eliminating.state.deadline).toBe(eliminatedAt + DEFAULT_ENGINE_CONFIG.eliminationDurationMs)

    const earlyElimination = applyGameCommand(
      eliminating.state,
      { type: "tick", now: eliminating.state.deadline! - 1 },
      random,
    )
    expect(earlyElimination).toEqual({ ok: true, state: eliminating.state, changed: false })
    const advancedAt = eliminating.state.deadline!
    const advanced = applyGameCommand(eliminating.state, { type: "tick", now: advancedAt }, random)
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.state.phase).toBe(nextPhase)
    if (nextPhase === "round_end") {
      expect(advanced.state.deadline).toBe(advancedAt + DEFAULT_ENGINE_CONFIG.roundEndDurationMs)
      const earlyRound = applyGameCommand(
        advanced.state,
        { type: "tick", now: advanced.state.deadline! - 1 },
        random,
      )
      expect(earlyRound).toEqual({ ok: true, state: advanced.state, changed: false })
    }
    state = advanced.state
    expect(validateGameState(state)).toEqual([])
  })

  it("maintains core invariants through a complete server-driven series", () => {
    const random = new DeterministicRandom()
    let state = newGame(
      random,
      players.map(() => ({ isBot: true, canReconnect: false, isConnected: false })),
    )

    for (let step = 0; step < 500 && state.phase !== "series_end"; step += 1) {
      expect(validateGameState(state)).toEqual([])
      expect(state.deadline).not.toBeNull()
      const result = applyGameCommand(state, { type: "tick", now: state.deadline! + 1 }, random)
      expect(result.ok).toBe(true)
      if (result.ok) state = result.state
    }

    expect(state.phase).toBe("series_end")
    expect(validateGameState(state)).toEqual([])
    expect(state.players.filter((player) => !player.isEliminated)).toHaveLength(1)
  })

  it("preserves invariants across many seeded multi-round bot series", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = new SeededRandom(seed)
      let state = createGame(
        {
          gameId: `seeded-${seed}`,
          players: players.map((player) => ({
            ...player,
            isBot: true,
            canReconnect: false,
            isConnected: false,
          })),
          roundsToWin: 3,
          now: 1_000,
          config: {
            turnDurationMs: 10,
            botThinkDurationMs: 5,
            revealDurationMs: 5,
            eliminationDurationMs: 5,
            roundEndDurationMs: 5,
          },
        },
        random,
      )

      for (let step = 0; step < 2_000 && state.phase !== "series_end"; step += 1) {
        expect(validateGameState(state), `seed ${seed}, step ${step}`).toEqual([])
        expect(state.deadline, `seed ${seed}, step ${step}`).not.toBeNull()
        const result = applyGameCommand(state, { type: "tick", now: state.deadline! + 1 }, random)
        expect(result.ok, `seed ${seed}, step ${step}`).toBe(true)
        if (result.ok) state = result.state
      }

      expect(state.phase, `seed ${seed}`).toBe("series_end")
      expect(validateGameState(state), `seed ${seed}`).toEqual([])
      expect(state.players.filter((player) => player.seriesWins >= 3), `seed ${seed}`).toHaveLength(1)
    }
  })

  it("does not mutate prior state and rejects stale commands", () => {
    const state = newGame()
    const before = JSON.stringify(state)
    const target = state.players.find(
      (player) => player.id !== state.currentPlayerId && !player.isEliminated,
    )!
    const accepted = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 1,
    })

    expect(accepted.ok).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
    const stale = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version + 1,
      turnId: state.turnId,
      now: state.deadline! - 1,
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe("CONFLICT")
  })

  it.each([
    ["at", 0],
    ["after", 1],
  ])("rejects target selection %s the authoritative deadline", (_label, offset) => {
    const state = newGame()
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const result = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! + offset,
    })

    expect(result.ok).toBe(false)
    expect(result.state).toBe(state)
    expect(result.changed).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({ code: "CONFLICT", message: "This turn has expired" })
    }
  })

  it.each([
    ["at", 0],
    ["after", 1],
  ])("rejects card selection %s the authoritative deadline", (_label, offset) => {
    const state = newGame()
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const targeted = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 1,
    })
    expect(targeted.ok).toBe(true)
    if (!targeted.ok) return

    const result = applyGameCommand(targeted.state, {
      type: "pick_card",
      playerId: state.currentPlayerId,
      cardToken: targeted.state.cards[0].selectionToken,
      expectedVersion: targeted.state.version,
      turnId: targeted.state.turnId,
      now: targeted.state.deadline! + offset,
    })

    expect(result.ok).toBe(false)
    expect(result.state).toBe(targeted.state)
    expect(result.changed).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({ code: "CONFLICT", message: "This turn has expired" })
    }
  })

  it("moves every card and rotates every token after a miss", () => {
    const random = new DeterministicRandom()
    const state = newGame(random)
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const targetResult = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 2,
    })
    expect(targetResult.ok).toBe(true)
    if (!targetResult.ok) return

    const miss = targetResult.state.cards.find(
      (card) => card.ownerId !== state.currentPlayerId && card.ownerId !== target.id,
    )!
    const oldPositions = new Map(targetResult.state.cards.map((card) => [card.ownerId, card.position]))
    const oldTokens = new Set(targetResult.state.cards.map((card) => card.selectionToken))
    const oldCurrentPlayerId = targetResult.state.currentPlayerId
    const pickResult = applyGameCommand(targetResult.state, {
      type: "pick_card",
      playerId: state.currentPlayerId,
      cardToken: miss.selectionToken,
      expectedVersion: targetResult.state.version,
      turnId: targetResult.state.turnId,
      now: targetResult.state.deadline! - 1,
    })
    expect(pickResult.ok).toBe(true)
    if (!pickResult.ok) return
    expect(pickResult.state.pendingEliminationId).toBeNull()

    const advanced = applyGameCommand(
      pickResult.state,
      { type: "tick", now: pickResult.state.deadline! },
      random,
    )
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.state.phase).toBe("shuffling")
    expect(advanced.state.deadline).toBe(pickResult.state.deadline! + DEFAULT_ENGINE_CONFIG.shuffleDurationMs)
    expect(advanced.state.currentPlayerId).toBe(oldCurrentPlayerId)
    expect(advanced.state.cards.every((card) => card.position !== oldPositions.get(card.ownerId))).toBe(true)
    expect(advanced.state.cards.every((card) => !oldTokens.has(card.selectionToken))).toBe(true)
    expect(validateGameState(advanced.state)).toEqual([])

    const early = applyGameCommand(
      advanced.state,
      { type: "tick", now: advanced.state.deadline! - 1 },
      random,
    )
    expect(early).toEqual({ ok: true, state: advanced.state, changed: false })
    const nextTurn = applyGameCommand(
      advanced.state,
      { type: "tick", now: advanced.state.deadline! },
      random,
    )
    expect(nextTurn.ok).toBe(true)
    if (!nextTurn.ok) return
    expect(nextTurn.state.phase).toBe("select_target")
    expect(nextTurn.state.currentPlayerId).not.toBe(oldCurrentPlayerId)
  })

  it("eliminates the seeker after they reveal their own card", () => {
    const random = new DeterministicRandom()
    const state = newGame(random)
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const targeted = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 2,
    })
    expect(targeted.ok).toBe(true)
    if (!targeted.ok) return

    const ownCard = targeted.state.cards.find((card) => card.ownerId === state.currentPlayerId)!
    const picked = applyGameCommand(targeted.state, {
      type: "pick_card",
      playerId: state.currentPlayerId,
      cardToken: ownCard.selectionToken,
      expectedVersion: targeted.state.version,
      turnId: targeted.state.turnId,
      now: targeted.state.deadline! - 1,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok) return
    expect(picked.state.pendingEliminationId).toBe(state.currentPlayerId)
    expect(picked.state.lastMessage).toContain("trapdoor")

    const advanced = applyGameCommand(picked.state, { type: "tick", now: picked.state.deadline! }, random)
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.state.phase).toBe("elimination")
    expect(advanced.state.players.find((player) => player.id === state.currentPlayerId)?.isEliminated).toBe(true)
    expect(advanced.state.cards).toHaveLength(state.cards.length - 1)
    expect(validateGameState(advanced.state)).toEqual([])
  })

  it("rotates opaque tokens and positions after an elimination shuffle", () => {
    const random = new DeterministicRandom()
    const state = newGame(random)
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const targeted = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 2,
    })
    expect(targeted.ok).toBe(true)
    if (!targeted.ok) return

    const targetCard = targeted.state.cards.find((card) => card.ownerId === target.id)!
    const oldPositions = new Map(targeted.state.cards.map((card) => [card.ownerId, card.position]))
    const oldTokens = new Set(targeted.state.cards.map((card) => card.selectionToken))
    const picked = applyGameCommand(targeted.state, {
      type: "pick_card",
      playerId: state.currentPlayerId,
      cardToken: targetCard.selectionToken,
      expectedVersion: targeted.state.version,
      turnId: targeted.state.turnId,
      now: targeted.state.deadline! - 1,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok) return

    const eliminating = applyGameCommand(
      picked.state,
      { type: "tick", now: picked.state.deadline! + 1 },
      random,
    )
    expect(eliminating.ok).toBe(true)
    if (!eliminating.ok) return
    expect(eliminating.state.cards.every((card) => card.position !== oldPositions.get(card.ownerId))).toBe(true)
    expect(eliminating.state.cards.every((card) => !oldTokens.has(card.selectionToken))).toBe(true)
    const advanced = applyGameCommand(
      eliminating.state,
      { type: "tick", now: eliminating.state.deadline! + 1 },
      random,
    )
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.state.cards.every((card) => !oldTokens.has(card.selectionToken))).toBe(true)
    expect(validateGameState(advanced.state)).toEqual([])
  })

  it("starts each new round with a fresh set of cards", () => {
    const random = new DeterministicRandom()
    let state = advanceStarting(createGame(
      {
        gameId: "round-reset",
        players: players.slice(0, 2),
        roundsToWin: 2,
        now: 1_000,
        config: {
          turnDurationMs: 10,
          botThinkDurationMs: 5,
          revealDurationMs: 5,
          eliminationDurationMs: 5,
          roundEndDurationMs: 5,
        },
      },
      random,
    ), random)
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const targetCard = state.cards.find((card) => card.ownerId === target.id)!

    const targeted = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 1,
    })
    expect(targeted.ok).toBe(true)
    if (!targeted.ok) return
    const picked = applyGameCommand(targeted.state, {
      type: "pick_card",
      playerId: targeted.state.currentPlayerId,
      cardToken: targetCard.selectionToken,
      expectedVersion: targeted.state.version,
      turnId: targeted.state.turnId,
      now: targeted.state.deadline! - 1,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok) return
    const priorCardIds = new Set(picked.state.cards.map((card) => card.secretId))
    state = picked.state

    for (const expectedPhase of ["elimination", "round_end", "select_target"] as const) {
      const advanced = applyGameCommand(state, { type: "tick", now: state.deadline! + 1 }, random)
      expect(advanced.ok).toBe(true)
      if (!advanced.ok) return
      state = advanced.state
      expect(state.phase).toBe(expectedPhase)
    }

    expect(state.currentRound).toBe(2)
    expect(state.players.every((player) => !player.isEliminated)).toBe(true)
    expect(state.cards.every((card) => !priorCardIds.has(card.secretId))).toBe(true)
    expect(validateGameState(state)).toEqual([])
  })

  it("rejects persisted non-terminal states without an actionable deadline", () => {
    const missingDeadline = { ...newGame(), deadline: null }
    expect(validateGameState(missingDeadline)).toContain(
      "non-terminal phases require a finite safe-integer deadline",
    )

    const invalidDeadline = { ...newGame(), deadline: Number.POSITIVE_INFINITY }
    expect(validateGameState(invalidDeadline)).toContain(
      "non-terminal phases require a finite safe-integer deadline",
    )

    const terminalWithDeadline = {
      ...newGame(),
      phase: "series_end" as const,
      deadline: 2_000,
    }
    expect(validateGameState(terminalWithDeadline)).toContain("series_end must not have a deadline")
  })

  it("rejects persisted turn phases that cannot advance safely", () => {
    const onePlayerTurn = newGame()
    onePlayerTurn.players = onePlayerTurn.players.map((player) => ({
      ...player,
      isEliminated: player.id !== onePlayerTurn.currentPlayerId,
    }))
    onePlayerTurn.cards = onePlayerTurn.cards
      .filter((card) => card.ownerId === onePlayerTurn.currentPlayerId)
      .map((card, position) => ({ ...card, position }))
    expect(validateGameState(onePlayerTurn)).toContain("select_target requires at least two active players")

    const eliminatedActor = newGame()
    eliminatedActor.players = eliminatedActor.players.map((player) => ({
      ...player,
      isEliminated: player.id === eliminatedActor.currentPlayerId,
    }))
    eliminatedActor.cards = eliminatedActor.cards
      .filter((card) => card.ownerId !== eliminatedActor.currentPlayerId)
      .map((card, position) => ({ ...card, position }))
    expect(validateGameState(eliminatedActor)).toContain("select_target requires an active current player")

    const invalidCardPhase = newGame()
    invalidCardPhase.phase = "select_card"
    invalidCardPhase.targetPlayerId = invalidCardPhase.currentPlayerId
    expect(validateGameState(invalidCardPhase)).toContain(
      "select_card requires a different active target player",
    )
  })

  it("rejects invalid persisted counters and engine configuration", () => {
    const invalidVersion = newGame()
    invalidVersion.version = -1
    expect(validateGameState(invalidVersion)).toContain(
      "game version must be a nonnegative safe integer",
    )

    const invalidRound = newGame()
    invalidRound.currentRound = 0
    expect(validateGameState(invalidRound)).toContain(
      "current round must be a positive safe integer",
    )

    const mismatchedRound = newGame()
    mismatchedRound.currentRound = 2
    expect(validateGameState(mismatchedRound)).toContain(
      "current round must match the number of completed rounds",
    )

    const configKeys: Array<keyof PrivateGameState["config"]> = [
      "turnDurationMs",
      "startDurationMs",
      "botThinkDurationMs",
      "revealDurationMs",
      "shuffleDurationMs",
      "eliminationDurationMs",
      "roundEndDurationMs",
    ]
    for (const key of configKeys) {
      const invalidConfig = newGame()
      invalidConfig.config[key] = 0
      expect(validateGameState(invalidConfig)).toContain(`${key} must be a positive safe integer`)
    }
  })

  it("enforces phase-specific target, pending-elimination, and selected-card fields", () => {
    const states = twoPlayerRoundStates(2)
    for (const state of Object.values(states)) expect(validateGameState(state)).toEqual([])

    const dirtyTurn = structuredClone(states.selectTarget)
    dirtyTurn.pendingEliminationId = dirtyTurn.players[0].id
    dirtyTurn.selectedCardSecretId = dirtyTurn.cards[0].secretId
    expect(validateGameState(dirtyTurn)).toEqual(expect.arrayContaining([
      "select_target must not have a pending elimination",
      "select_target must not have a selected card",
    ]))

    const mismatchedReveal = structuredClone(states.revealResult)
    mismatchedReveal.selectedCardSecretId = mismatchedReveal.cards.find(
      (card) => !card.isRevealed,
    )!.secretId
    mismatchedReveal.pendingEliminationId = mismatchedReveal.currentPlayerId
    expect(validateGameState(mismatchedReveal)).toEqual(expect.arrayContaining([
      "reveal_result selected card must match the revealed card",
      "reveal_result pending elimination must match the revealed card",
    ]))

    const missingPending = structuredClone(states.elimination)
    missingPending.pendingEliminationId = null
    expect(validateGameState(missingPending)).toContain(
      "elimination requires an eliminated pending player",
    )

    const missingTarget = structuredClone(states.elimination)
    missingTarget.targetPlayerId = null
    expect(validateGameState(missingTarget)).toContain(
      "elimination requires a different target player",
    )
  })

  it("enforces terminal survivor, winner, score, and round consistency", () => {
    const roundEnd = twoPlayerRoundStates(2).terminal
    expect(roundEnd.phase).toBe("round_end")
    expect(validateGameState(roundEnd)).toEqual([])

    const wrongRoundWinner = structuredClone(roundEnd)
    wrongRoundWinner.roundWinnerId = wrongRoundWinner.players.find(
      (player) => player.id !== wrongRoundWinner.roundWinnerId,
    )!.id
    expect(validateGameState(wrongRoundWinner)).toContain(
      "round_end winner must be the sole survivor",
    )

    const terminalRoundScore = structuredClone(roundEnd)
    terminalRoundScore.players.find(
      (player) => player.id === terminalRoundScore.roundWinnerId,
    )!.seriesWins = terminalRoundScore.roundsToWin
    expect(validateGameState(terminalRoundScore)).toContain(
      "round_end winner must have a non-terminal series score",
    )

    const seriesEnd = twoPlayerRoundStates(1).terminal
    expect(seriesEnd.phase).toBe("series_end")
    expect(validateGameState(seriesEnd)).toEqual([])

    const missingSeriesWinner = structuredClone(seriesEnd)
    missingSeriesWinner.seriesWinnerId = null
    expect(validateGameState(missingSeriesWinner)).toContain(
      "series_end winner must be the sole survivor",
    )

    const noSurvivor = structuredClone(seriesEnd)
    noSurvivor.players = noSurvivor.players.map((player) => ({ ...player, isEliminated: true }))
    noSurvivor.cards = []
    expect(validateGameState(noSurvivor)).toContain("series_end requires exactly one survivor")

    const invalidWinningScore = structuredClone(seriesEnd)
    invalidWinningScore.players.find(
      (player) => player.id === invalidWinningScore.seriesWinnerId,
    )!.seriesWins = 0
    expect(validateGameState(invalidWinningScore)).toContain(
      "series_end requires one sole survivor with the winning score",
    )
  })

  it("accepts only unique rematch votes from players in a finished series", () => {
    const seriesEnd = twoPlayerRoundStates(1).terminal
    const voterId = seriesEnd.players[0].id

    const duplicateVotes = structuredClone(seriesEnd)
    duplicateVotes.rematchVotes = [voterId, voterId]
    expect(validateGameState(duplicateVotes)).toContain("rematch votes must be unique")

    const missingVoter = structuredClone(seriesEnd)
    missingVoter.rematchVotes = ["missing-player"]
    expect(validateGameState(missingVoter)).toContain("rematch voter missing-player is missing")

    const prematureVote = newGame()
    prematureVote.rematchVotes = [prematureVote.players[0].id]
    expect(validateGameState(prematureVote)).toContain(
      "rematch votes are only valid during series_end",
    )

    const voted = applyGameCommand(seriesEnd, {
      type: "rematch_vote",
      playerId: voterId,
      expectedVersion: seriesEnd.version,
      now: 2_000,
    })
    expect(voted.ok).toBe(true)
    if (!voted.ok) return
    const converted = applyGameCommand(voted.state, {
      type: "convert_to_bot",
      playerId: voterId,
      canReconnect: false,
      now: 2_001,
    })
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    expect(validateGameState(converted.state)).toEqual([])
  })

  it("starts a rematch when a nonvoting human leaves or converts after the remaining human voted", () => {
    for (const canReconnect of [false, true]) {
      const random = new DeterministicRandom()
      const seriesEnd = twoPlayerRoundStates(1).terminal
      const voter = seriesEnd.players[0]
      const departingPlayer = seriesEnd.players[1]

      const voted = applyGameCommand(
        seriesEnd,
        {
          type: "rematch_vote",
          playerId: voter.id,
          expectedVersion: seriesEnd.version,
          now: 2_000,
        },
        random,
      )
      expect(voted.ok).toBe(true)
      if (!voted.ok) continue
      expect(voted.state.phase).toBe("series_end")
      expect(voted.state.rematchVotes).toEqual([voter.id])

      const converted = applyGameCommand(
        voted.state,
        {
          type: "convert_to_bot",
          playerId: departingPlayer.id,
          canReconnect,
          now: 2_001,
        },
        random,
      )
      expect(converted.ok).toBe(true)
      if (!converted.ok) continue

      expect(converted.state.phase).toBe("starting")
      expect(converted.state.rematchVotes).toEqual([])
      expect(converted.state.currentRound).toBe(1)
      expect(converted.state.roundWinnerId).toBeNull()
      expect(converted.state.seriesWinnerId).toBeNull()
      expect(converted.state.players).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: voter.id, isBot: false, isEliminated: false, seriesWins: 0 }),
        expect.objectContaining({
          id: departingPlayer.id,
          isBot: true,
          canReconnect,
          isEliminated: false,
          seriesWins: 0,
        }),
      ]))
      expect(converted.state.cards).toHaveLength(converted.state.players.length)
      expect(converted.state.version).toBe(voted.state.version + 1)
      expect(validateGameState(converted.state)).toEqual([])
    }
  })
})

describe("public game projection", () => {
  it("never exposes hidden owner IDs or stable private card IDs", () => {
    const state = newGame()
    const snapshot = projectGameState(state, {
      viewerPlayerId: "player-1",
      roomCode: null,
      isPrivate: false,
      hostPlayerId: "player-1",
      maxPlayers: 4,
      serverTime: 1_000,
    })

    expect(snapshot.cards).toHaveLength(state.cards.length)
    for (const card of snapshot.cards) {
      expect(Object.keys(card).sort()).toEqual(["isRevealed", "position", "revealedOwnerId", "token"])
      expect(card.isRevealed).toBe(false)
      expect(card.revealedOwnerId).toBeNull()
      expect(card).not.toHaveProperty("ownerId")
      expect(card).not.toHaveProperty("secretId")
      expect(card).not.toHaveProperty("selectionToken")
    }
    expect(snapshot.players.every((player) => !("observedCards" in player))).toBe(true)
  })

  it("reveals only the selected card owner during the reveal phase", () => {
    const state = newGame()
    const target = state.players.find((player) => player.id !== state.currentPlayerId)!
    const targeted = applyGameCommand(state, {
      type: "select_target",
      playerId: state.currentPlayerId,
      targetPlayerId: target.id,
      expectedVersion: state.version,
      turnId: state.turnId,
      now: state.deadline! - 2,
    })
    expect(targeted.ok).toBe(true)
    if (!targeted.ok) return
    const chosen = targeted.state.cards[0]
    const picked = applyGameCommand(targeted.state, {
      type: "pick_card",
      playerId: state.currentPlayerId,
      cardToken: chosen.selectionToken,
      expectedVersion: targeted.state.version,
      turnId: targeted.state.turnId,
      now: targeted.state.deadline! - 1,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok) return

    const snapshot = projectGameState(picked.state, {
      viewerPlayerId: "player-1",
      roomCode: null,
      isPrivate: false,
      hostPlayerId: "player-1",
      maxPlayers: 4,
      serverTime: 1_002,
    })
    const revealed = snapshot.cards.filter((card) => card.isRevealed)
    expect(revealed).toHaveLength(1)
    expect(revealed[0].revealedOwnerId).toBe(chosen.ownerId)
    expect(snapshot.cards.filter((card) => !card.isRevealed).every((card) => card.revealedOwnerId === null)).toBe(true)
  })
})
