import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { GamePlayerSnapshot, GameSnapshot, PlayerProfile } from "../lib/game-types"
import { ResultScreen } from "./ResultScreen"

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

function makePlayers(): GamePlayerSnapshot[] {
  return PLAYER_NAMES.map((displayName, index) => ({
    id: `player-${index + 1}`,
    displayName,
    avatarId: AVATAR_IDS[index],
    isBot: index > 0,
    isEliminated: index !== PLAYER_NAMES.length - 1,
    roundWins: index === PLAYER_NAMES.length - 1 ? 2 : 0,
  }))
}

function renderResult(): string {
  const players = makePlayers()
  const profile: PlayerProfile = {
    id: players[0].id,
    displayName: players[0].displayName,
    avatarId: "lyra",
  }
  const game: GameSnapshot = {
    id: "game-result-contract",
    lobbyId: "lobby-result-contract",
    version: 12,
    phase: "series_end",
    players,
    cards: [],
    currentPlayerId: players.at(-1)!.id,
    round: 3,
    roundsToWin: 2,
    winnerId: players.at(-1)!.id,
    message: `${players.at(-1)!.displayName} survives!`,
  }

  return renderToStaticMarkup(
    <ResultScreen
      profile={profile}
      game={game}
      connection="connected"
      solo
      rematchPending={false}
      onRematch={() => undefined}
      onHome={() => undefined}
      onRetry={() => undefined}
      onDismissError={() => undefined}
    />,
  )
}

describe("ResultScreen player identity", () => {
  it("keeps the winner portrait and all eight full player names", () => {
    const markup = renderResult()

    expect(markup).toContain('data-player-count="8"')
    expect(markup).toMatch(/winner-portrait"><span class="avatar avatar--xl /)
    expect(markup.match(/class="result-score(?: result-score--winner)?"/g)).toHaveLength(8)
    for (const name of PLAYER_NAMES) {
      expect(markup).toContain(`<strong>${name}</strong>`)
    }
  })

  it("uses You as metadata without replacing the local player's name", () => {
    const markup = renderResult()

    expect(markup).toContain("<strong>Alexandria Nightshade</strong>")
    expect(markup).toContain("<small>You · 0 wins</small>")
    expect(markup).not.toContain("<strong>You</strong>")
  })
})
