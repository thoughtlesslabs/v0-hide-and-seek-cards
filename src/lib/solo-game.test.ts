import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { GameCardSnapshot, GameSnapshot, PlayerProfile } from "./game-types"
import { SoloGame } from "./solo-game"

type PrivateSoloCard = GameCardSnapshot & { ownerId: string }

const START_MS = 1_500
const REVEAL_MS = 2_250
const SHUFFLE_MS = 1_000
const ELIMINATION_MS = 1_750

const PROFILE: PlayerProfile = {
  id: "local-player",
  displayName: "Tester",
  avatarId: "lyra",
}

describe("SoloGame card movement rules", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("window", globalThis)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("holds the starting phase before the first turn and after restart", () => {
    const game = new SoloGame(PROFILE)

    expect(game.getSnapshot().phase).toBe("starting")
    vi.advanceTimersByTime(START_MS - 1)
    expect(game.getSnapshot().phase).toBe("starting")
    vi.advanceTimersByTime(1)
    expect(game.getSnapshot().phase).toBe("select_target")

    game.restart()
    expect(game.getSnapshot().phase).toBe("starting")
    vi.advanceTimersByTime(START_MS - 1)
    expect(game.getSnapshot().phase).toBe("starting")
    vi.advanceTimersByTime(1)
    expect(game.getSnapshot().phase).toBe("select_target")
    game.dispose()
  })

  it("moves every card after a miss before the next turn", () => {
    const game = new SoloGame(PROFILE)
    vi.advanceTimersByTime(START_MS)
    const before = game.getSnapshot()
    const target = before.players.find((player) => player.id !== PROFILE.id)!
    const missCard = (before.cards as PrivateSoloCard[]).find(
      (card) => card.ownerId !== PROFILE.id && card.ownerId !== target.id,
    )!
    const oldPositions = new Map((before.cards as PrivateSoloCard[]).map((card) => [card.ownerId, card.position]))
    const oldIds = new Set(before.cards.map((card) => card.id))

    expect(game.selectTarget(target.id)).toBe(true)
    expect(game.selectCard(missCard.id)).toBe(true)
    expect(game.getSnapshot().phase).toBe("revealing")
    vi.advanceTimersByTime(REVEAL_MS - 1)
    expect(game.getSnapshot().phase).toBe("revealing")
    vi.advanceTimersByTime(1)

    const moved = game.getSnapshot()
    expect(moved.phase).toBe("shuffling")
    expect(
      (moved.cards as PrivateSoloCard[]).every((card) => card.position !== oldPositions.get(card.ownerId)),
    ).toBe(true)
    expect(moved.cards.every((card) => !oldIds.has(card.id))).toBe(true)

    vi.advanceTimersByTime(SHUFFLE_MS - 1)
    expect(game.getSnapshot().phase).toBe("shuffling")
    vi.advanceTimersByTime(1)
    expect(game.getSnapshot().phase).toBe("select_target")
    game.dispose()
  })

  it("eliminates the seeker after they reveal their own card", () => {
    const game = new SoloGame(PROFILE)
    vi.advanceTimersByTime(START_MS)
    const before = game.getSnapshot()
    const target = before.players.find((player) => player.id !== PROFILE.id)!
    const ownCard = (before.cards as PrivateSoloCard[]).find((card) => card.ownerId === PROFILE.id)!

    expect(game.selectTarget(target.id)).toBe(true)
    expect(game.selectCard(ownCard.id)).toBe(true)
    expect(game.getSnapshot()).toMatchObject({
      phase: "revealing",
      pendingEliminationId: PROFILE.id,
      lastEvent: { kind: "self_found" },
    })
    expect(game.getSnapshot().message).toContain("trapdoor")

    vi.advanceTimersByTime(REVEAL_MS)
    const after = game.getSnapshot()
    expect(after.phase).toBe("eliminating")
    expect(after.pendingEliminationId).toBe(PROFILE.id)
    expect(after.lastEvent?.kind).toBe("self_found")
    expect(after.players.find((player) => player.id === PROFILE.id)?.isEliminated).toBe(true)
    expect(after.cards).toHaveLength(before.cards.length - 1)
    game.dispose()
  })

  it("removes a found player and moves every surviving card", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    const game = new SoloGame(PROFILE)
    vi.advanceTimersByTime(START_MS)
    const before = game.getSnapshot()
    const privateCards = before.cards as PrivateSoloCard[]
    const target = before.players.find((player) => player.id !== PROFILE.id)!
    const targetCard = privateCards.find((card) => card.ownerId === target.id)!
    const oldPositions = new Map(privateCards.map((card) => [card.ownerId, card.position]))

    expect(game.selectTarget(target.id)).toBe(true)
    expect(game.selectCard(targetCard.id)).toBe(true)
    vi.advanceTimersByTime(REVEAL_MS - 1)
    expect(game.getSnapshot().phase).toBe("revealing")
    expect(game.getSnapshot().players.find((player) => player.id === target.id)?.isEliminated).toBe(false)
    vi.advanceTimersByTime(1)

    const after = game.getSnapshot()
    expect(after.phase).toBe("eliminating")
    expect(after.players.find((player) => player.id === target.id)?.isEliminated).toBe(true)
    expect(after.cards).toHaveLength(before.cards.length - 1)
    expect(after.cards.some((card) => card.id === targetCard.id)).toBe(false)
    expect(
      (after.cards as PrivateSoloCard[]).every((card) => card.position !== oldPositions.get(card.ownerId)),
    ).toBe(true)
    vi.advanceTimersByTime(ELIMINATION_MS - 1)
    expect(game.getSnapshot().phase).toBe("eliminating")
    vi.advanceTimersByTime(1)
    expect(game.getSnapshot().phase).toBe("select_target")
    game.dispose()
  })

  it("holds the final elimination before showing results", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    const game = new SoloGame(PROFILE)
    vi.advanceTimersByTime(START_MS)

    const initial = game.getSnapshot()
    const opponent = initial.players.find((player) => player.id !== PROFILE.id)!
    const retainedIds = new Set([PROFILE.id, opponent.id])
    const internal = game as unknown as { snapshot: GameSnapshot }
    internal.snapshot = {
      ...initial,
      players: initial.players.map((player) => ({
        ...player,
        isEliminated: !retainedIds.has(player.id),
      })),
      cards: (initial.cards as PrivateSoloCard[])
        .filter((card) => retainedIds.has(card.ownerId))
        .map((card, position) => ({ ...card, position })),
    }
    const targetCard = (internal.snapshot.cards as PrivateSoloCard[]).find(
      (card) => card.ownerId === opponent.id,
    )!

    expect(game.selectTarget(opponent.id)).toBe(true)
    expect(game.selectCard(targetCard.id)).toBe(true)
    vi.advanceTimersByTime(REVEAL_MS)

    expect(game.getSnapshot().phase).toBe("eliminating")
    expect(game.getSnapshot().players.filter((player) => !player.isEliminated)).toHaveLength(1)
    expect(game.getSnapshot().winnerId).toBeUndefined()
    vi.advanceTimersByTime(ELIMINATION_MS - 1)
    expect(game.getSnapshot().phase).toBe("eliminating")
    vi.advanceTimersByTime(1)
    expect(game.getSnapshot()).toMatchObject({
      phase: "series_end",
      winnerId: PROFILE.id,
      roundWinnerId: PROFILE.id,
    })
    game.dispose()
  })
})
