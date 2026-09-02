import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { EmptyStateScreen, FatalConnectionScreen } from "./StateScreens"

describe("state screen layout", () => {
  it("uses the shared scroll-safe shell for empty states", () => {
    const markup = renderToStaticMarkup(
      <EmptyStateScreen title="Nothing here" message="Try another room." onHome={() => undefined} />,
    )

    expect(markup).toContain('<main class="screen scroll-screen state-screen-shell">')
    expect(markup).toContain('<section class="state-screen state-screen--card">')
  })

  it("uses the same shell and inner card for fatal connection states", () => {
    const markup = renderToStaticMarkup(
      <FatalConnectionScreen
        onRetry={() => undefined}
        onSolo={() => undefined}
        onHome={() => undefined}
      />,
    )

    expect(markup).toContain('<main class="screen scroll-screen state-screen-shell">')
    expect(markup).toContain('<section class="state-screen state-screen--card">')
  })
})
