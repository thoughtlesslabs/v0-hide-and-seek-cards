import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { GameCardSnapshot, GamePlayerSnapshot } from "../lib/game-types"
import { GameCard } from "./GameCard"

describe("GameCard reveal", () => {
  it("renders the revealed character portrait and full name eagerly", () => {
    const card: GameCardSnapshot = {
      id: "card-nightshade",
      position: 2,
      isRevealed: true,
      revealedOwnerId: "player-nightshade",
    }
    const owner: GamePlayerSnapshot = {
      id: "player-nightshade",
      displayName: "Professor Nightshade",
      avatarId: "orin",
      isBot: false,
      isEliminated: false,
      roundWins: 0,
    }

    const markup = renderToStaticMarkup(
      <GameCard
        card={card}
        index={2}
        total={8}
        revealedOwner={owner}
        canPick={false}
        pending={false}
        onPick={() => undefined}
      />,
    )

    expect(markup).toContain("game-card--revealed")
    expect(markup).toContain('data-card-id="card-nightshade"')
    expect(markup).toContain('aria-label="Hiding place 3 reveals Professor Nightshade"')
    expect(markup).toContain('class="game-card__portrait"')
    expect(markup).toContain('src="/assets/characters-party/orin.webp"')
    expect(markup).toContain('loading="eager"')
    expect(markup).toContain('decoding="async"')
    expect(markup).toContain("<strong>Professor Nightshade</strong>")
  })
})
