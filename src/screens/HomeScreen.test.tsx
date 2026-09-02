import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { HomeScreen } from "./HomeScreen"

describe("HomeScreen", () => {
  it("provides conventional one-tap mute and settings controls", () => {
    const markup = renderToStaticMarkup(
      <HomeScreen
        profile={{ id: "me", displayName: "Me", avatarId: "lyra" }}
        connection="connected"
        audioEnabled={true}
        onToggleAudio={() => undefined}
        onQuickMatch={() => undefined}
        onPrivateRoom={() => undefined}
        onSolo={() => undefined}
        onHowToPlay={() => undefined}
        onTutorial={() => undefined}
        onAchievements={() => undefined}
        onSettings={() => undefined}
        onRetry={() => undefined}
        onDismissError={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="Mute all audio"')
    expect(markup).toContain('aria-label="Open settings"')
    expect(markup).toContain('aria-pressed="false"')
  })
})
