import { io as createSocketClient, type Socket } from "socket.io-client"
import { describe, expect, it, vi } from "vitest"

import {
  type AckCallback,
  type ClientToServerEvents,
  type PublicGameSnapshot,
  type ServerToClientEvents,
  type SessionReadyEvent,
  type SessionResponse,
  type SocketAck,
} from "../shared/protocol"
import { createGameServer, type GameServer, type GameServerLogger } from "./app"
import { SessionTokenService } from "./auth"
import type { PersistedRoom, SessionIdentity } from "./model"
import { InMemorySnapshotStore, type SnapshotStore } from "./snapshot-store"

const TEST_ORIGIN = "http://integration.test"
const EVENT_TIMEOUT_MS = 3_000

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const silentLogger: GameServerLogger = {
  info() {},
  warn() {},
  error() {},
}

class RecoveringIntegrationStore implements SnapshotStore {
  kind = "memory-fallback"
  available = false

  constructor(private readonly rooms: Map<string, PersistedRoom>) {}

  async loadAll(): Promise<PersistedRoom[]> {
    if (!this.available) {
      this.kind = "memory-fallback"
      return []
    }
    this.kind = "redis"
    return [...this.rooms.values()].map((room) => structuredClone(room))
  }

  async save(room: PersistedRoom): Promise<void> {
    if (!this.available) {
      this.kind = "memory-fallback"
      return
    }
    this.kind = "redis"
    this.rooms.set(room.id, structuredClone(room))
  }

  async delete(roomId: string): Promise<void> {
    if (!this.available) {
      this.kind = "memory-fallback"
      return
    }
    this.kind = "redis"
    this.rooms.delete(roomId)
  }
}

class BlockingIntegrationStore extends InMemorySnapshotStore {
  private releaseBlockedSave!: () => void
  private saveStartedResolve!: () => void
  readonly saveStarted = new Promise<void>((resolve) => {
    this.saveStartedResolve = resolve
  })
  private readonly blockedSaveReleased = new Promise<void>((resolve) => {
    this.releaseBlockedSave = resolve
  })
  blockNextSave = false

  override async save(room: PersistedRoom): Promise<void> {
    if (this.blockNextSave) {
      this.blockNextSave = false
      this.saveStartedResolve()
      await this.blockedSaveReleased
    }
    await super.save(room)
  }

  release(): void {
    this.releaseBlockedSave()
  }
}

function persistedWaitingRoom(identity: SessionIdentity): PersistedRoom {
  return {
    schemaVersion: 1,
    id: "cold-start-room",
    code: "RSTR24",
    isPrivate: true,
    hostPlayerId: identity.userId,
    status: "waiting",
    maxPlayers: 4,
    roundsToWin: 1,
    revision: 2,
    createdAt: Date.now() - 1_000,
    updatedAt: Date.now() - 500,
    matchmakingDeadline: null,
    members: [
      {
        userId: identity.userId,
        displayName: identity.displayName,
        avatarSeed: identity.avatarSeed,
        activeSocketIds: ["socket-before-restart"],
        disconnectedAt: null,
        joinedAt: Date.now() - 1_000,
      },
    ],
    game: null,
    reactions: [],
    processedCommandIds: ["persisted-create-command"],
  }
}

function serverBaseUrl(server: GameServer): string {
  const address = server.httpServer.address()
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port")
  return `http://127.0.0.1:${address.port}`
}

function withTimeout<T>(description: string, subscribe: (resolve: (value: T) => void) => () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unsubscribe = (): void => undefined
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for ${description}`))
    }, EVENT_TIMEOUT_MS)

    unsubscribe = subscribe((value) => {
      clearTimeout(timeout)
      unsubscribe()
      resolve(value)
    })
  })
}

function acknowledge(
  emit: (ack: AckCallback<PublicGameSnapshot>) => void,
): Promise<SocketAck<PublicGameSnapshot>> {
  return withTimeout("socket acknowledgement", (resolve) => {
    emit(resolve)
    return () => undefined
  })
}

function successfulSnapshot(ack: SocketAck<PublicGameSnapshot>): PublicGameSnapshot {
  expect(ack.ok).toBe(true)
  if (!ack.ok) throw new Error(`${ack.error.code}: ${ack.error.message}`)
  return ack.data
}

async function createAnonymousSession(
  baseUrl: string,
  profile: { displayName: string; avatarSeed: "lyra" | "rowan" },
): Promise<SessionResponse> {
  const response = await fetch(`${baseUrl}/v1/session/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
    body: JSON.stringify(profile),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as SessionResponse
}

async function connectAuthenticated(
  baseUrl: string,
  session: SessionResponse,
  expectedResumedRoomId: string | null = null,
): Promise<TestSocket> {
  const socket = createSocketClient(baseUrl, {
    auth: { token: session.token },
    autoConnect: false,
    extraHeaders: { Origin: TEST_ORIGIN },
    forceNew: true,
    reconnection: false,
    timeout: EVENT_TIMEOUT_MS,
    transports: ["websocket"],
  }) as TestSocket

  const ready = withTimeout<SessionReadyEvent>("authenticated session readiness", (resolve) => {
    const onReady = (event: SessionReadyEvent): void => resolve(event)
    socket.on("session:ready", onReady)
    return () => socket.off("session:ready", onReady)
  })
  socket.connect()

  const event = await ready
  expect(event.player).toEqual(session.player)
  expect(event.resumedRoomId).toBe(expectedResumedRoomId)
  return socket
}

async function expectRejectedConnection(
  baseUrl: string,
  session: SessionResponse,
  expectedCode: "INTERNAL_ERROR" | "RATE_LIMITED",
): Promise<void> {
  const socket = createSocketClient(baseUrl, {
    auth: { token: session.token },
    autoConnect: false,
    extraHeaders: { Origin: TEST_ORIGIN },
    forceNew: true,
    reconnection: false,
    timeout: EVENT_TIMEOUT_MS,
    transports: ["websocket"],
  }) as TestSocket
  try {
    const rejected = withTimeout<Error & { data?: unknown }>("rejected socket connection", (resolve) => {
      const onError = (error: Error): void => resolve(error)
      socket.on("connect_error", onError)
      return () => socket.off("connect_error", onError)
    })
    socket.connect()
    await expect(rejected).resolves.toMatchObject({ data: { code: expectedCode, retryable: true } })
    expect(socket.connected).toBe(false)
  } finally {
    socket.disconnect()
  }
}

async function expectTransportRejected(
  baseUrl: string,
  session: SessionResponse,
  origin: string,
): Promise<void> {
  const socket = createSocketClient(baseUrl, {
    auth: { token: session.token },
    autoConnect: false,
    extraHeaders: { Origin: origin },
    forceNew: true,
    reconnection: false,
    timeout: EVENT_TIMEOUT_MS,
    transports: ["websocket"],
  }) as TestSocket
  try {
    const rejected = withTimeout<Error>("transport-level socket rejection", (resolve) => {
      const onError = (error: Error): void => resolve(error)
      socket.on("connect_error", onError)
      return () => socket.off("connect_error", onError)
    })
    socket.connect()
    await expect(rejected).resolves.toBeInstanceOf(Error)
    expect(socket.connected).toBe(false)
  } finally {
    socket.disconnect()
  }
}

function waitForSnapshot(
  socket: TestSocket,
  predicate: (snapshot: PublicGameSnapshot) => boolean,
): Promise<PublicGameSnapshot> {
  return withTimeout("matching state snapshot", (resolve) => {
    const onSnapshot = (snapshot: PublicGameSnapshot): void => {
      if (predicate(snapshot)) resolve(snapshot)
    }
    socket.on("state:snapshot", onSnapshot)
    return () => socket.off("state:snapshot", onSnapshot)
  })
}

function expectNoHiddenCardData(snapshot: PublicGameSnapshot): void {
  expect(snapshot.cards).toHaveLength(snapshot.players.length)
  for (const card of snapshot.cards) {
    expect(Object.keys(card).sort()).toEqual(["isRevealed", "position", "revealedOwnerId", "token"])
    expect(card.token.length).toBeGreaterThanOrEqual(16)
    expect(card.isRevealed).toBe(false)
    expect(card.revealedOwnerId).toBeNull()
    expect(card).not.toHaveProperty("ownerId")
    expect(card).not.toHaveProperty("secretId")
    expect(card).not.toHaveProperty("selectionToken")
  }

  const serialized = JSON.stringify(snapshot)
  expect(serialized).not.toContain('"ownerId"')
  expect(serialized).not.toContain('"secretId"')
  expect(serialized).not.toContain('"selectionToken"')
}

describe("game server HTTP and Socket.IO integration", () => {
  it("stays unready after a cold-start outage, then rehydrates without a process restart", async () => {
    const sessionTokens = new SessionTokenService({
      secret: "integration-test-signing-secret-with-more-than-32-bytes",
    })
    const session = sessionTokens.createAnonymousSession({
      displayName: "Recovered Lyra",
      avatarSeed: "lyra",
    })
    const persisted = persistedWaitingRoom(session.identity)
    const store = new RecoveringIntegrationStore(new Map([[persisted.id, persisted]]))
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: store,
      sessionTokens,
      logger: silentLogger,
      tickIntervalMs: 60_000,
      recoveryIntervalMs: 20,
    })
    let socket: TestSocket | null = null

    try {
      await server.start()
      const baseUrl = serverBaseUrl(server)
      const initialHealth = await fetch(`${baseUrl}/healthz`)
      const initialReady = await fetch(`${baseUrl}/readyz`)

      expect(initialHealth.status).toBe(200)
      expect(initialReady.status).toBe(503)
      expect(await initialReady.json()).toMatchObject({
        ok: false,
        degraded: true,
        persistence: "degraded",
        snapshotStore: "memory-fallback",
        rooms: 0,
      })

      const unavailableSession = await fetch(`${baseUrl}/v1/session/anonymous`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
        body: JSON.stringify({ displayName: "Waiting Player", avatarSeed: "lyra" }),
      })
      expect(unavailableSession.status).toBe(503)
      await expectRejectedConnection(baseUrl, session.response, "INTERNAL_ERROR")

      store.available = true

      await vi.waitFor(
        async () => {
          const response = await fetch(`${baseUrl}/readyz`)
          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({
            ok: true,
            degraded: false,
            persistence: "durable",
            snapshotStore: "redis",
            rooms: 1,
            connectedPlayers: 0,
          })
        },
        { timeout: 2_000, interval: 20 },
      )

      socket = await connectAuthenticated(baseUrl, session.response, persisted.id)
      const resumed = successfulSnapshot(
        await acknowledge((ack) => socket!.emit("state:sync", { knownVersion: persisted.revision }, ack)),
      )
      expect(resumed).toMatchObject({ roomId: persisted.id, selfPlayerId: session.identity.userId })

      // A later Redis incident reduces durability but must not eject active
      // games from routing or encourage a restart that loses buffered writes.
      store.available = false
      store.kind = "memory-fallback"
      const runtimeFallback = await fetch(`${baseUrl}/readyz`)
      expect(runtimeFallback.status).toBe(200)
      expect(await runtimeFallback.json()).toMatchObject({
        ok: true,
        degraded: true,
        persistence: "degraded",
        snapshotStore: "memory-fallback",
      })
    } finally {
      socket?.disconnect()
      await server.stop()
    }
  }, 10_000)

  it("bounds global and per-player concurrent socket connections", async () => {
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: new InMemorySnapshotStore(),
      sessionTokens: new SessionTokenService({
        secret: "integration-test-signing-secret-with-more-than-32-bytes",
      }),
      logger: silentLogger,
      tickIntervalMs: 60_000,
      maxSocketConnections: 2,
      maxSocketConnectionsPerUser: 1,
    })
    const sockets: TestSocket[] = []

    try {
      await server.start()
      const baseUrl = serverBaseUrl(server)
      const firstSession = await createAnonymousSession(baseUrl, { displayName: "Limit Lyra", avatarSeed: "lyra" })
      const secondSession = await createAnonymousSession(baseUrl, { displayName: "Limit Rowan", avatarSeed: "rowan" })
      const thirdSession = await createAnonymousSession(baseUrl, { displayName: "Limit Mira", avatarSeed: "lyra" })

      sockets.push(await connectAuthenticated(baseUrl, firstSession))
      await expectRejectedConnection(baseUrl, firstSession, "RATE_LIMITED")
      await vi.waitFor(() => expect(server.io.engine.clientsCount).toBe(1), {
        timeout: EVENT_TIMEOUT_MS,
        interval: 10,
      })
      sockets.push(await connectAuthenticated(baseUrl, secondSession))
      await expectTransportRejected(baseUrl, thirdSession, TEST_ORIGIN)

      expect(server.io.sockets.sockets.size).toBe(2)
      expect(server.io.engine.clientsCount).toBe(2)
    } finally {
      for (const socket of sockets) socket.disconnect()
      await server.stop()
    }
  }, 10_000)

  it("rejects a WebSocket upgrade from an origin outside the allowlist", async () => {
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: new InMemorySnapshotStore(),
      sessionTokens: new SessionTokenService({
        secret: "integration-test-signing-secret-with-more-than-32-bytes",
      }),
      logger: silentLogger,
      tickIntervalMs: 60_000,
    })

    try {
      await server.start()
      const baseUrl = serverBaseUrl(server)
      const session = await createAnonymousSession(baseUrl, { displayName: "Origin Lyra", avatarSeed: "lyra" })

      await expectTransportRejected(baseUrl, session, "https://not-allowed.example")
      expect(server.io.engine.clientsCount).toBe(0)
      expect(server.io.sockets.sockets.size).toBe(0)
    } finally {
      await server.stop()
    }
  }, 10_000)

  it("reserves pre-auth Engine.IO capacity across simultaneous raw handshakes", async () => {
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: new InMemorySnapshotStore(),
      sessionTokens: new SessionTokenService({
        secret: "integration-test-signing-secret-with-more-than-32-bytes",
      }),
      logger: silentLogger,
      tickIntervalMs: 60_000,
      maxSocketConnections: 1,
    })
    const sockets: WebSocket[] = []

    try {
      await server.start()
      const websocketUrl = `${serverBaseUrl(server).replace("http://", "ws://")}/socket.io/?EIO=4&transport=websocket`
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () => {
          const socket = new WebSocket(websocketUrl)
          sockets.push(socket)
          return withTimeout<"open" | "rejected">("raw Engine.IO admission", (resolve) => {
            const onOpen = (): void => resolve("open")
            const onError = (): void => resolve("rejected")
            socket.addEventListener("open", onOpen, { once: true })
            socket.addEventListener("error", onError, { once: true })
            return () => {
              socket.removeEventListener("open", onOpen)
              socket.removeEventListener("error", onError)
            }
          })
        }),
      )

      expect(outcomes.filter((outcome) => outcome === "open")).toHaveLength(1)
      expect(server.io.engine.clientsCount).toBe(1)
      expect(server.io.sockets.sockets.size).toBe(0)
    } finally {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
      }
      await server.stop()
    }
  }, 10_000)

  it("notifies and disconnects a socket when its session expires", async () => {
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: new InMemorySnapshotStore(),
      sessionTokens: new SessionTokenService({
        secret: "integration-test-signing-secret-with-more-than-32-bytes",
        ttlSeconds: 2,
      }),
      logger: silentLogger,
      tickIntervalMs: 60_000,
    })
    let socket: TestSocket | null = null

    try {
      await server.start()
      const baseUrl = serverBaseUrl(server)
      const session = await createAnonymousSession(baseUrl, { displayName: "Expiring Lyra", avatarSeed: "lyra" })
      socket = await connectAuthenticated(baseUrl, session)
      const expiryError = withTimeout<Parameters<ServerToClientEvents["server:error"]>[0]>(
        "session expiry error",
        (resolve) => {
          const onError: ServerToClientEvents["server:error"] = (event) => resolve(event)
          socket!.on("server:error", onError)
          return () => socket?.off("server:error", onError)
        },
      )

      await expect(expiryError).resolves.toMatchObject({
        error: { code: "UNAUTHORIZED", retryable: true },
      })
      await vi.waitFor(() => expect(socket?.connected).toBe(false), { timeout: EVENT_TIMEOUT_MS })
    } finally {
      socket?.disconnect()
      await server.stop()
    }
  }, 10_000)

  it("rejects an action that arrives after expiry even before the timer callback", async () => {
    let serverNow = 1_000_000
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: new InMemorySnapshotStore(),
      sessionTokens: new SessionTokenService({
        secret: "integration-test-signing-secret-with-more-than-32-bytes",
        ttlSeconds: 60,
      }),
      logger: silentLogger,
      tickIntervalMs: 60_000,
      now: () => serverNow,
    })
    let socket: TestSocket | null = null

    try {
      await server.start()
      const baseUrl = serverBaseUrl(server)
      const session = await createAnonymousSession(baseUrl, { displayName: "Boundary Lyra", avatarSeed: "lyra" })
      socket = await connectAuthenticated(baseUrl, session)
      const expiryError = withTimeout<Parameters<ServerToClientEvents["server:error"]>[0]>(
        "per-action session expiry error",
        (resolve) => {
          const onError: ServerToClientEvents["server:error"] = (event) => resolve(event)
          socket!.on("server:error", onError)
          return () => socket?.off("server:error", onError)
        },
      )
      serverNow = session.expiresAt

      const acknowledgement = await acknowledge((ack) =>
        socket!.emit("state:sync", { knownVersion: 0 }, ack),
      )

      expect(acknowledgement).toMatchObject({
        ok: false,
        error: { code: "UNAUTHORIZED", retryable: true },
      })
      await expect(expiryError).resolves.toMatchObject({ error: { code: "UNAUTHORIZED", retryable: true } })
      await vi.waitFor(() => expect(socket?.connected).toBe(false), { timeout: EVENT_TIMEOUT_MS })
    } finally {
      socket?.disconnect()
      await server.stop()
    }
  }, 10_000)

  it("waits for an in-flight acknowledged mutation before its final shutdown flush", async () => {
    const store = new BlockingIntegrationStore()
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: store,
      sessionTokens: new SessionTokenService({
        secret: "integration-test-signing-secret-with-more-than-32-bytes",
      }),
      logger: silentLogger,
      tickIntervalMs: 60_000,
    })
    let socket: TestSocket | null = null
    let stopped = false

    try {
      await server.start()
      const baseUrl = serverBaseUrl(server)
      const session = await createAnonymousSession(baseUrl, { displayName: "Drain Lyra", avatarSeed: "lyra" })
      socket = await connectAuthenticated(baseUrl, session)
      store.blockNextSave = true
      const acknowledgement = acknowledge((ack) =>
        socket!.emit(
          "private:create",
          { commandId: "shutdown-drain-create", maxPlayers: 4, roundsToWin: 1 },
          ack,
        ),
      )
      await store.saveStarted

      const stopping = server.stop().then(() => {
        stopped = true
      })
      await Promise.resolve()
      expect(stopped).toBe(false)
      store.release()

      expect(successfulSnapshot(await acknowledgement)).toMatchObject({ status: "waiting" })
      await stopping
      expect(stopped).toBe(true)
      expect((await store.loadAll()).map(({ id }) => id)).toHaveLength(1)
    } finally {
      store.release()
      socket?.disconnect()
      if (!stopped) await server.stop()
    }
  }, 10_000)

  it("lets the same client reconnect and resume after a graceful server replacement", async () => {
    const store = new InMemorySnapshotStore()
    const sessionTokens = new SessionTokenService({
      secret: "integration-test-signing-secret-with-more-than-32-bytes",
    })
    const createServer = (port: number) =>
      createGameServer({
        host: "127.0.0.1",
        port,
        production: false,
        allowedOrigins: [TEST_ORIGIN],
        clientDistDir: null,
        snapshotStore: store,
        sessionTokens,
        logger: silentLogger,
        tickIntervalMs: 60_000,
      })
    const firstServer = createServer(0)
    let replacementServer: GameServer | null = null
    let socket: TestSocket | null = null
    let firstStopped = false

    try {
      await firstServer.start()
      const baseUrl = serverBaseUrl(firstServer)
      const address = firstServer.httpServer.address()
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port")
      const session = await createAnonymousSession(baseUrl, { displayName: "Restart Lyra", avatarSeed: "lyra" })
      socket = createSocketClient(baseUrl, {
        auth: { token: session.token },
        autoConnect: false,
        extraHeaders: { Origin: TEST_ORIGIN },
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 50,
        reconnectionDelay: 20,
        reconnectionDelayMax: 50,
        randomizationFactor: 0,
        timeout: EVENT_TIMEOUT_MS,
        transports: ["websocket"],
      }) as TestSocket
      const initialReady = withTimeout<SessionReadyEvent>("initial restart-test session", (resolve) => {
        const onReady = (event: SessionReadyEvent): void => resolve(event)
        socket!.on("session:ready", onReady)
        return () => socket?.off("session:ready", onReady)
      })
      socket.connect()
      await initialReady
      const room = successfulSnapshot(
        await acknowledge((ack) =>
          socket!.emit(
            "private:create",
            { commandId: "restart-room-create", maxPlayers: 4, roundsToWin: 1 },
            ack,
          ),
        ),
      )

      let disconnectReason: string | undefined
      let reconnectAttempts = 0
      socket.once("disconnect", (reason) => {
        disconnectReason = reason
      })
      socket.io.on("reconnect_attempt", () => {
        reconnectAttempts += 1
      })
      const resumed = withTimeout<SessionReadyEvent>("session resume after replacement", (resolve) => {
        const onReady = (event: SessionReadyEvent): void => {
          if (event.resumedRoomId === room.roomId) resolve(event)
        }
        socket!.on("session:ready", onReady)
        return () => socket?.off("session:ready", onReady)
      })

      await firstServer.stop()
      firstStopped = true
      replacementServer = createServer(address.port)
      await replacementServer.start()

      await expect(resumed).resolves.toMatchObject({ resumedRoomId: room.roomId })
      expect(disconnectReason).not.toBe("io server disconnect")
      expect(reconnectAttempts).toBeGreaterThan(0)
      expect(socket.connected).toBe(true)
      expect(
        successfulSnapshot(await acknowledge((ack) => socket!.emit("state:sync", {}, ack))),
      ).toMatchObject({ roomId: room.roomId, selfPlayerId: session.player.id })
    } finally {
      socket?.disconnect()
      if (!firstStopped) await firstServer.stop()
      if (replacementServer) await replacementServer.stop()
    }
  }, 10_000)

  it("authenticates two anonymous players and keeps private card ownership server-only", async () => {
    const store = new InMemorySnapshotStore()
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      production: false,
      allowedOrigins: [TEST_ORIGIN],
      clientDistDir: null,
      snapshotStore: store,
      sessionTokens: new SessionTokenService({
        secret: "integration-test-signing-secret-with-more-than-32-bytes",
      }),
      logger: silentLogger,
      tickIntervalMs: 60_000,
    })
    const sockets: TestSocket[] = []
    let stopped = false

    try {
      await server.start()
      const baseUrl = serverBaseUrl(server)

      const unauthorized = createSocketClient(baseUrl, {
        autoConnect: false,
        extraHeaders: { Origin: TEST_ORIGIN },
        forceNew: true,
        reconnection: false,
        timeout: EVENT_TIMEOUT_MS,
        transports: ["websocket"],
      }) as TestSocket
      const rejected = withTimeout<Error & { data?: unknown }>("unauthenticated socket rejection", (resolve) => {
        const onError = (error: Error): void => resolve(error)
        unauthorized.on("connect_error", onError)
        return () => unauthorized.off("connect_error", onError)
      })
      unauthorized.connect()
      const authError = await rejected
      expect(authError.data).toMatchObject({ code: "UNAUTHORIZED", retryable: false })
      expect(unauthorized.connected).toBe(false)
      unauthorized.disconnect()

      const quickSession = await createAnonymousSession(baseUrl, { displayName: "Quick Lyra", avatarSeed: "lyra" })
      const quickHost = await connectAuthenticated(baseUrl, quickSession)
      sockets.push(quickHost)
      const quickWaiting = successfulSnapshot(
        await acknowledge((ack) => quickHost.emit(
          "matchmaking:join",
          { commandId: "quick-room-join", maxPlayers: 4, roundsToWin: 1 },
          ack,
        )),
      )
      expect(quickWaiting).toMatchObject({ isPrivate: false, status: "waiting", canStart: true })
      const quickStarted = successfulSnapshot(
        await acknowledge((ack) => quickHost.emit("room:start", { commandId: "quick-room-start" }, ack)),
      )
      expect(quickStarted.players.filter((player) => player.isBot)).toHaveLength(3)

      const hostSession = await createAnonymousSession(baseUrl, { displayName: "Test Lyra", avatarSeed: "lyra" })
      const guestSession = await createAnonymousSession(baseUrl, { displayName: "Test Rowan", avatarSeed: "rowan" })
      const host = await connectAuthenticated(baseUrl, hostSession)
      sockets.push(host)
      const guest = await connectAuthenticated(baseUrl, guestSession)
      sockets.push(guest)

      const created = successfulSnapshot(
        await acknowledge((ack) =>
          host.emit(
            "private:create",
            { commandId: "create-room-0001", maxPlayers: 4, roundsToWin: 2 },
            ack,
          ),
        ),
      )
      expect(created).toMatchObject({
        status: "waiting",
        isPrivate: true,
        selfPlayerId: hostSession.player.id,
        hostPlayerId: hostSession.player.id,
        canStart: true,
      })
      expect(created.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)

      const hostSawGuest = waitForSnapshot(
        host,
        (snapshot) => snapshot.status === "waiting" && snapshot.players.length === 2,
      )
      const joined = successfulSnapshot(
        await acknowledge((ack) =>
          guest.emit(
            "private:join",
            { commandId: "join-room-0001", roomCode: created.roomCode! },
            ack,
          ),
        ),
      )
      expect(joined).toMatchObject({
        roomId: created.roomId,
        selfPlayerId: guestSession.player.id,
        hostPlayerId: hostSession.player.id,
        canStart: false,
      })
      expect((await hostSawGuest).players.map((player) => player.id)).toEqual([
        hostSession.player.id,
        guestSession.player.id,
      ])

      const guestSawStart = waitForSnapshot(guest, (snapshot) => snapshot.status === "in_progress")
      const started = successfulSnapshot(
        await acknowledge((ack) => host.emit("private:start", { commandId: "start-room-0001" }, ack)),
      )
      expect(started).toMatchObject({
        roomId: created.roomId,
        status: "in_progress",
        phase: "starting",
        selfPlayerId: hostSession.player.id,
      })
      const guestStarted = await guestSawStart
      expect(guestStarted).toMatchObject({
        phase: "starting",
        deadline: started.deadline,
        selfPlayerId: guestSession.player.id,
      })

      const hostSnapshot = successfulSnapshot(
        await acknowledge((ack) => host.emit("state:sync", { knownVersion: started.version }, ack)),
      )
      const guestSnapshot = successfulSnapshot(
        await acknowledge((ack) => guest.emit("state:sync", { knownVersion: started.version }, ack)),
      )
      expect(hostSnapshot.selfPlayerId).toBe(hostSession.player.id)
      expect(guestSnapshot.selfPlayerId).toBe(guestSession.player.id)
      expect(hostSnapshot.roomId).toBe(guestSnapshot.roomId)
      expect(hostSnapshot.version).toBe(guestSnapshot.version)
      expect(hostSnapshot.players).toEqual(guestSnapshot.players)
      expect(hostSnapshot.cards).toEqual(guestSnapshot.cards)
      expectNoHiddenCardData(hostSnapshot)
      expectNoHiddenCardData(guestSnapshot)

      const [privateRoom] = await store.loadAll()
      expect(privateRoom.game?.cards).toHaveLength(hostSnapshot.cards.length)
      expect(privateRoom.game?.cards.every((card) => Boolean(card.ownerId && card.secretId && card.selectionToken))).toBe(
        true,
      )

      await server.stop()
      stopped = true
      expect(server.httpServer.listening).toBe(false)
      expect(server.io.sockets.sockets.size).toBe(0)
      await vi.waitFor(() => {
        expect(host.connected).toBe(false)
        expect(guest.connected).toBe(false)
      })
    } finally {
      for (const socket of sockets) socket.disconnect()
      if (!stopped) await server.stop()
    }
  }, 10_000)
})
