import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { createGameServer, parseTrustProxySetting } from "./app"
import { SessionTokenService } from "./auth"
import { InMemorySnapshotStore } from "./snapshot-store"

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("game server deployment configuration", () => {
  it("parses numeric trust-proxy values as hop counts instead of IP addresses", () => {
    expect(parseTrustProxySetting("1")).toBe(1)
    expect(parseTrustProxySetting(" 2 ")).toBe(2)
  })

  it("preserves boolean and named proxy settings", () => {
    expect(parseTrustProxySetting("true")).toBe(true)
    expect(parseTrustProxySetting("false")).toBe(false)
    expect(parseTrustProxySetting("loopback")).toBe("loopback")
    expect(parseTrustProxySetting("10.0.0.0/8")).toBe("10.0.0.0/8")
  })

  it("fails fast instead of silently accepting malformed integer settings", () => {
    vi.stubEnv("MAX_SOCKET_CONNECTIONS", "2000connections")

    expect(() =>
      createGameServer({
        production: false,
        allowedOrigins: ["http://config.test"],
        clientDistDir: null,
        snapshotStore: new InMemorySnapshotStore(),
        sessionTokens: new SessionTokenService({ secret: "config-test-secret-with-at-least-thirty-two-bytes" }),
      }),
    ).toThrow("MAX_SOCKET_CONNECTIONS must be a positive safe integer")
  })

  it("serves the extensionless Apple association file as JSON", async () => {
    const clientDistDir = mkdtempSync(resolve(tmpdir(), "hide-and-seek-cards-public-"))
    temporaryDirectories.push(clientDistDir)
    const wellKnownDirectory = resolve(clientDistDir, ".well-known")
    mkdirSync(wellKnownDirectory)
    const association = {
      applinks: {
        details: [
          {
            appIDs: ["4SF8573TA6.com.thoughtlesslabs.hideandseekcards"],
            components: [{ "/": "/join/*" }],
          },
        ],
      },
    }
    writeFileSync(resolve(wellKnownDirectory, "apple-app-site-association"), JSON.stringify(association))

    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: ["http://config.test"],
      clientDistDir,
      snapshotStore: new InMemorySnapshotStore(),
      sessionTokens: new SessionTokenService({ secret: "config-test-secret-with-at-least-thirty-two-bytes" }),
    })

    try {
      await server.start()
      const address = server.httpServer.address()
      expect(address && typeof address !== "string").toBe(true)
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port")

      const response = await fetch(
        `http://127.0.0.1:${address.port}/.well-known/apple-app-site-association`,
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await response.json()).toEqual(association)
    } finally {
      await server.stop()
    }
  })
})
