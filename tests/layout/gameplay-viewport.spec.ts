import { expect, test, type Page } from "@playwright/test"

const VIEWPORTS = [
  { name: "small-android", width: 320, height: 568 },
  { name: "common-android", width: 360, height: 740 },
  { name: "pixel-galaxy", width: 412, height: 915 },
  { name: "large-phone", width: 430, height: 932 },
  { name: "ultra-tall-note", width: 412, height: 1000 },
  { name: "short-landscape", width: 740, height: 360 },
] as const

const SCENARIOS = [
  { name: "game-4-select-card", root: ".game-screen", parts: [".app-header", ".turn-panel", ".player-roster--seated", ".card-table", ".game-toolbar"] },
  { name: "game-8-select-card", root: ".game-screen", parts: [".app-header", ".turn-panel", ".player-roster--seated", ".card-table", ".game-toolbar"] },
  { name: "game-8-revealing", root: ".game-screen", parts: [".app-header", ".turn-panel", ".player-roster--seated", ".card-table", ".game-toolbar"] },
  { name: "result-8", root: ".result-screen", parts: [".result-card", ".result-scores", ".result-actions"] },
] as const

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number }

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

async function layoutMetrics(page: Page, selectors: readonly string[]) {
  return page.evaluate((parts) => {
    const boxFor = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        bodyScrollWidth: document.body.scrollWidth,
        bodyScrollHeight: document.body.scrollHeight,
      },
      boxes: Object.fromEntries(parts.map((selector) => [selector, boxFor(selector)])),
    }
  }, selectors)
}

for (const viewport of VIEWPORTS) {
  for (const scenario of SCENARIOS) {
    test(`${scenario.name} fits ${viewport.name} ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/__layout-qa?scenario=${scenario.name}`)
      await expect(page.locator(scenario.root)).toBeVisible()

      const metrics = await layoutMetrics(page, scenario.parts)
      expect(metrics.document.scrollWidth, "document should not require horizontal scrolling").toBeLessThanOrEqual(metrics.viewport.width + 1)
      expect(metrics.document.bodyScrollWidth, "body should not require horizontal scrolling").toBeLessThanOrEqual(metrics.viewport.width + 1)
      expect(metrics.document.scrollHeight, "document should not require vertical scrolling").toBeLessThanOrEqual(metrics.viewport.height + 1)
      expect(metrics.document.bodyScrollHeight, "body should not require vertical scrolling").toBeLessThanOrEqual(metrics.viewport.height + 1)

      for (const selector of scenario.parts) {
        const box = metrics.boxes[selector]
        expect(box, `${selector} should render`).not.toBeNull()
        expect(box!.width, `${selector} should have width`).toBeGreaterThan(0)
        expect(box!.height, `${selector} should have height`).toBeGreaterThan(0)
        expect(box!.left, `${selector} should stay inside the left viewport edge`).toBeGreaterThanOrEqual(-1)
        expect(box!.right, `${selector} should stay inside the right viewport edge`).toBeLessThanOrEqual(metrics.viewport.width + 1)
        expect(box!.top, `${selector} should stay inside the top viewport edge`).toBeGreaterThanOrEqual(-1)
        expect(box!.bottom, `${selector} should stay inside the bottom viewport edge`).toBeLessThanOrEqual(metrics.viewport.height + 1)
      }

      const toolbar = metrics.boxes[".game-toolbar"]
      const cardTable = metrics.boxes[".card-table"]
      if (toolbar && cardTable) {
        expect(intersects(toolbar, cardTable), "reaction toolbar should not cover the table").toBe(false)
      }
    })
  }
}
