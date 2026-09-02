import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DEFAULT_PREFERENCES } from "../lib/storage"
import { SettingsScreen } from "./SettingsScreen"

describe("SettingsScreen", () => {
  it("keeps music and effects preferences beneath one master audio switch", () => {
    const markup = renderToStaticMarkup(
      <SettingsScreen
        profile={{ id: "me", displayName: "Me", avatarId: "lyra" }}
        preferences={{ ...DEFAULT_PREFERENCES, audioEnabled: false }}
        onChange={() => undefined}
        onEditProfile={() => undefined}
        onResetLocalData={async () => true}
        onBack={() => undefined}
      />,
    )

    expect(markup).toContain("All audio")
    expect(markup).toContain("Master switch for music and sound effects")
    expect(markup).toContain("Music volume")
    expect(markup).toContain("Effects volume")
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
  })
})
