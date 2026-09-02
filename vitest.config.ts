import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      include: ["shared/**/*.ts", "server/**/*.ts"],
    },
  },
})
