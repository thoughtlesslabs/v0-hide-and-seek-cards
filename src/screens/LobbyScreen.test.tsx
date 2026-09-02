import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LobbyScreen } from "./LobbyScreen"

describe("LobbyScreen", () => {
  it("lets a connected private-room host start alone with house bots", () => {
    const markup = renderToStaticMarkup(
      <LobbyScreen
        profile={{ id: "host", displayName: "Host", avatarId: "lyra" }}
        lobby={{
          id: "lobby",
          mode: "private",
          inviteCode: "ABC234",
          hostId: "host",
          players: [{
            id: "host",
            displayName: "Host",
            avatarId: "lyra",
            isBot: false,
            isHost: true,
            isReady: true,
          }],
          maxPlayers: 4,
          roundsToWin: 2,
          status: "waiting",
          canStart: false,
        }}
        connection="connected"
        pending={false}
        onStart={() => undefined}
        onLeave={() => undefined}
        onRetry={() => undefined}
        onDismissError={() => undefined}
      />,
    )

    const startButton = markup.match(/<button class="button button--primary"[^>]*>[\s\S]*?Invite house bots[\s\S]*?<\/button>/)?.[0]
    expect(startButton).toBeDefined()
    expect(startButton).not.toContain("disabled")
  })
})
