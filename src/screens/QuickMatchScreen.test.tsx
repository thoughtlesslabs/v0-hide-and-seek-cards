import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { QuickMatchScreen } from "./QuickMatchScreen"

describe("QuickMatchScreen", () => {
  it("offers both table sizes and every supported game length", () => {
    const markup = renderToStaticMarkup(
      <QuickMatchScreen
        connection="connected"
        initialOptions={{ maxPlayers: 8, roundsToWin: 3 }}
        onStart={() => undefined}
        onRetry={() => undefined}
        onDismissError={() => undefined}
        onBack={() => undefined}
      />,
    )

    expect(markup).toContain("4 players")
    expect(markup).toContain("8 players")
    expect(markup).toContain("1 round")
    expect(markup).toContain("Best of 3")
    expect(markup).toContain("Best of 5")
    expect(markup).toContain("8-player table · First to 3 wins")
    expect(markup).toContain('name="quick-players" checked=""')
    expect(markup).toContain('name="quick-rounds" checked=""')
  })
})
