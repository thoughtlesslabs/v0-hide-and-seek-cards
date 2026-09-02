import { validateNativeReleaseOrigin } from "./native-release-origin.mjs"

try {
  const origin = validateNativeReleaseOrigin(process.env.VITE_GAME_SERVER_URL)
  console.log(`Native release server: ${origin}`)
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown native release configuration error"
  console.error(`Native release check failed: ${message}`)
  process.exitCode = 1
}
