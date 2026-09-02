import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type {
  GameCardSnapshot,
  GamePhase,
  GamePlayerSnapshot,
  GameSnapshot,
  PlayerProfile,
} from "../lib/game-types"
import { GameScreen } from "./GameScreen"

const PLAYER_NAMES = [
  "Alexandria Nightshade",
  "Bartholomew Graves",
  "Cassandra Moonflower",
  "Demetrius Holloway",
  "Evangeline Blackwood",
  "Fitzwilliam Ravenscroft",
  "Guinevere Thornberry",
  "Hieronymus Dusk",
] as const

const AVATAR_IDS = ["lyra", "rowan", "mira", "bramble", "sol", "nia", "kestrel", "orin"] as const

function makePlayers(count: 4 | 8): GamePlayerSnapshot[] {
  return PLAYER_NAMES.slice(0, count).map((displayName, index) => ({
    id: `player-${index + 1}`,
    displayName,
    avatarId: AVATAR_IDS[index],
    isBot: index > 0,
    isEliminated: false,
    roundWins: 0,
  }))
}

function makeCards(count: number): GameCardSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `card-${count - index}`,
    position: count - index - 1,
    isRevealed: false,
  }))
}

function makeGame(
  playerCount: 4 | 8,
  phase: GamePhase,
  options: { cards?: GameCardSnapshot[]; players?: GamePlayerSnapshot[] } = {},
): GameSnapshot {
  const players = options.players ?? makePlayers(playerCount)
  return {
    id: "game-table-contract",
    lobbyId: "lobby-table-contract",
    version: 7,
    phase,
    players,
    cards: options.cards ?? makeCards(playerCount),
    currentPlayerId: players[0].id,
    targetPlayerId: phase === "select_card" ? players[1].id : undefined,
    round: 2,
    roundsToWin: 2,
    canAct: true,
    message: phase === "select_target" ? "Choose a player." : "Choose a card.",
  }
}

function renderGame(game: GameSnapshot, online = false): string {
  const profile: PlayerProfile = {
    id: game.players[0].id,
    displayName: game.players[0].displayName,
    avatarId: "lyra",
  }

  return renderToStaticMarkup(
    <GameScreen
      profile={profile}
      game={game}
      connection="connected"
      solo={!online}
      onSelectTarget={async () => true}
      onPickCard={async () => true}
      onReaction={online ? () => undefined : undefined}
      onRetry={() => undefined}
      onDismissError={() => undefined}
      onLeave={() => undefined}
    />,
  )
}

function attributeValues(markup: string, attribute: string): string[] {
  return Array.from(markup.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g")), (match) => match[1])
}

describe("GameScreen tabletop markup", () => {
  it.each([4, 8] as const)("renders all %i full player names in table order", (playerCount) => {
    const game = makeGame(playerCount, "select_target")
    const markup = renderGame(game)

    expect(markup).toContain(`data-player-count="${playerCount}"`)
    expect(attributeValues(markup, "data-player-id")).toEqual(game.players.map((player) => player.id))
    expect(attributeValues(markup, "data-card-id")).toEqual(
      [...game.cards].sort((left, right) => left.position - right.position).map((card) => card.id),
    )

    for (const player of game.players) {
      expect(markup).toContain(`<strong>${player.displayName}</strong>`)
      expect(markup).toContain(`aria-label="${player.displayName}`)
    }
  })

  it.each([4, 8] as const)("keeps %i-player seat and card topology stable from target to card selection", (playerCount) => {
    const players = makePlayers(playerCount)
    const cards = makeCards(playerCount)
    const targetMarkup = renderGame(makeGame(playerCount, "select_target", { players, cards }))
    const cardMarkup = renderGame(makeGame(playerCount, "select_card", { players, cards }))

    expect(attributeValues(cardMarkup, "data-player-id")).toEqual(attributeValues(targetMarkup, "data-player-id"))
    expect(attributeValues(cardMarkup, "data-card-id")).toEqual(attributeValues(targetMarkup, "data-card-id"))
    expect(cardMarkup).toContain(`card-grid--${playerCount}`)
    expect(targetMarkup).toContain(`card-grid--${playerCount}`)
  })

  it("retains an eight-place card layout when eliminated players leave empty slots", () => {
    const players = makePlayers(8).map((player, index) => ({
      ...player,
      isEliminated: index >= 6,
    }))
    const game = makeGame(8, "eliminating", {
      players,
      cards: makeCards(6),
    })
    const markup = renderGame(game)

    expect(attributeValues(markup, "data-player-id")).toHaveLength(8)
    expect(attributeValues(markup, "data-card-id")).toHaveLength(6)
    expect(markup.match(/data-empty-card-slot/g)).toHaveLength(2)
    expect(markup).toContain("card-grid--8")
  })

  it("keeps all reactions directly available during online play", () => {
    const markup = renderGame(makeGame(4, "select_target"), true)

    expect(markup).toContain('aria-label="Send a reaction"')
    expect(markup.match(/class="reaction-strip__button"/g)).toHaveLength(4)
    for (const emoji of ["👍", "😄", "😮", "👏"]) {
      expect(markup).toContain(`aria-label="Send ${emoji} reaction"`)
    }
  })

  it("announces and marks a self-elimination as a trapdoor event", () => {
    const players = makePlayers(4)
    const cards = makeCards(4).map((card, index) => index === 0
      ? { ...card, isRevealed: true, revealedOwnerId: players[0].id }
      : card,
    )
    const game: GameSnapshot = {
      ...makeGame(4, "revealing", { players, cards }),
      pendingEliminationId: players[0].id,
      message: `${players[0].displayName} revealed their own card and triggered the trapdoor!`,
      lastEvent: {
        id: "self-elimination",
        kind: "self_found",
        message: "Trapdoor!",
        actorId: players[0].id,
        ownerId: players[0].id,
      },
    }
    const markup = renderGame(game)

    expect(markup).toContain("Trapdoor!")
    expect(markup).toContain(`${players[0].displayName} found their own card!`)
    expect(markup).toContain("player-chip--eliminating")
    expect(markup).toContain("TRAP!")
  })
})
