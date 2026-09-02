import { createGameServer } from "./app"

const gameServer = createGameServer()
let stopping = false

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  console.info(`Received ${signal}; draining the game server`)
  const forcedExit = setTimeout(() => {
    console.error("Graceful shutdown timed out")
    process.exit(1)
  }, 15_000)
  forcedExit.unref()
  try {
    await gameServer.stop()
    clearTimeout(forcedExit)
    process.exit(0)
  } catch (error) {
    console.error("Graceful shutdown failed", error)
    process.exit(1)
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"))
process.once("SIGINT", () => void shutdown("SIGINT"))

gameServer.start().catch((error) => {
  console.error("Game server failed to start", error)
  process.exit(1)
})
