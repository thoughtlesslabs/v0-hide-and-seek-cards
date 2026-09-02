import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { AVATARS } from "../src/lib/avatars"

describe("character portrait assets", () => {
  it("bundles a portrait for every selectable character", () => {
    for (const avatar of AVATARS) {
      expect(existsSync(resolve(process.cwd(), `public${avatar.imagePath}`)), avatar.imagePath).toBe(true)
    }
  })
})
