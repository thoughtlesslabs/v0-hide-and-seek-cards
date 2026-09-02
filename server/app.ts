import { existsSync } from "node:fs"
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http"
import { resolve } from "node:path"

import cors from "cors"
import express, { type Express, type NextFunction, type Request, type Response } from "express"
import helmet from "helmet"
import { Server as SocketIOServer, type Socket } from "socket.io"
import type { ZodType } from "zod"

import {
  AnonymousSessionInputSchema,
  MatchmakingJoinInputSchema,
  PickCardInputSchema,
  PrivateCreateInputSchema,
  PrivateJoinInputSchema,
  PrivateStartInputSchema,
  RoomStartInputSchema,
  ReactionInputSchema,
  RematchVoteInputSchema,
  RoomLeaveInputSchema,
  SelectTargetInputSchema,
  StateSyncInputSchema,
  type AckCallback,
  type ClientToServerEvents,
  type InterServerEvents,
  type PublicGameSnapshot,
  type ServerToClientEvents,
  type SocketData,
} from "../shared/protocol"
import { SessionTokenService } from "./auth"
import { failureAck, GameServerError, successAck, toProtocolError } from "./errors"
import type { SessionIdentity } from "./model"
import { SlidingWindowRateLimiter, type RateLimitRule } from "./rate-limit"
import { RoomManager } from "./room-manager"
import { createSnapshotStoreFromEnv, type SnapshotStore } from "./snapshot-store"

export interface GameServerLogger {
  info(message: string, details?: unknown): void
  warn(message: string, details?: unknown): void
  error(message: string, details?: unknown): void
}

export interface CreateGameServerOptions {
  host?: string
  port?: number
  production?: boolean
  allowedOrigins?: string[]
  clientDistDir?: string | null
  snapshotStore?: SnapshotStore
  sessionTokens?: SessionTokenService
  logger?: GameServerLogger
  tickIntervalMs?: number
  recoveryIntervalMs?: number
  now?: () => number
  matchmakingWaitMs?: number
  disconnectGraceMs?: number
  idleRoomTtlMs?: number
  maxSocketConnections?: number
  maxSocketConnectionsPerUser?: number
}

export interface GameServer {
  app: Express
  httpServer: HttpServer
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  roomManager: RoomManager
  start(): Promise<void>
  stop(): Promise<void>
}

const JOIN_RATE: RateLimitRule = { limit: 6, windowMs: 30_000 }
const ACTION_RATE: RateLimitRule = { limit: 12, windowMs: 5_000 }
const REACTION_RATE: RateLimitRule = { limit: 4, windowMs: 5_000 }
const SYNC_RATE: RateLimitRule = { limit: 20, windowMs: 10_000 }
const SESSION_RATE: RateLimitRule = { limit: 10, windowMs: 60_000 }
const SESSION_EXPIRY_TIMER_SLICE_MS = 24 * 60 * 60_000
const ENGINE_ADMISSION_TIMEOUT_MS = 15_000

const consoleLogger: GameServerLogger = {
  info: (message, details) => console.info(message, details ?? ""),
  warn: (message, details) => console.warn(message, details ?? ""),
  error: (message, details) => console.error(message, details ?? ""),
}

function integerFromEnv(name: string, fallback: number): number {
  const configured = process.env[name]?.trim()
  if (!configured) return fallback
  if (!/^\d+$/.test(configured)) throw new Error(`${name} must be a positive safe integer`)
  const parsed = Number(configured)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

export function parseTrustProxySetting(value: string): boolean | number | string {
  const normalized = value.trim()
  if (normalized === "true") return true
  if (normalized === "false" || normalized === "") return false
  if (/^\d+$/.test(normalized)) {
    const hops = Number.parseInt(normalized, 10)
    if (Number.isSafeInteger(hops)) return hops
  }
  return normalized
}

function configuredOrigins(production: boolean): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (configured && configured.length > 0) return configured
  if (production) throw new Error("ALLOWED_ORIGINS is required in production")
  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "capacitor://localhost",
    "http://localhost",
  ]
}

function socketIdentity(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>): SessionIdentity {
  return {
    userId: socket.data.userId,
    displayName: socket.data.displayName,
    avatarSeed: socket.data.avatarSeed,
    tokenId: socket.data.tokenId,
    issuedAt: socket.data.issuedAt,
    expiresAt: socket.data.expiresAt,
  }
}

function roomChannel(roomId: string): string {
  return `game:${roomId}`
}

export function createGameServer(options: CreateGameServerOptions = {}): GameServer {
  const production = options.production ?? process.env.NODE_ENV === "production"
  const now = options.now ?? Date.now
  const logger = options.logger ?? consoleLogger
  const host = options.host ?? process.env.HOST ?? "0.0.0.0"
  const port = options.port ?? integerFromEnv("PORT", 8787)
  const allowedOrigins = options.allowedOrigins ?? configuredOrigins(production)
  const clientDistDir =
    options.clientDistDir === undefined
      ? resolve(process.cwd(), process.env.CLIENT_DIST_DIR ?? "dist")
      : options.clientDistDir
  const sessionTokens =
    options.sessionTokens ??
    new SessionTokenService({
      production,
      warn: (message) => logger.warn(message),
    })
  const snapshotStore =
    options.snapshotStore ??
    createSnapshotStoreFromEnv((message, error) => logger.warn(message, error), production)
  const maxSocketConnections =
    options.maxSocketConnections ?? integerFromEnv("MAX_SOCKET_CONNECTIONS", 2_000)
  const maxSocketConnectionsPerUser =
    options.maxSocketConnectionsPerUser ?? integerFromEnv("MAX_SOCKET_CONNECTIONS_PER_USER", 4)
  if (!Number.isSafeInteger(maxSocketConnections) || maxSocketConnections <= 0) {
    throw new Error("MAX_SOCKET_CONNECTIONS must be a positive safe integer")
  }
  if (!Number.isSafeInteger(maxSocketConnectionsPerUser) || maxSocketConnectionsPerUser <= 0) {
    throw new Error("MAX_SOCKET_CONNECTIONS_PER_USER must be a positive safe integer")
  }
  const roomManager = new RoomManager({
    store: snapshotStore,
    now,
    matchmakingWaitMs: options.matchmakingWaitMs ?? integerFromEnv("MATCHMAKING_WAIT_MS", 8_000),
    disconnectGraceMs: options.disconnectGraceMs ?? integerFromEnv("DISCONNECT_GRACE_MS", 30_000),
    idleRoomTtlMs: options.idleRoomTtlMs ?? integerFromEnv("ROOM_IDLE_TTL_MS", 2 * 60 * 60_000),
    maxSocketsPerUser: maxSocketConnectionsPerUser,
    warn: (message, error) => logger.warn(message, error),
  })
  const limiter = new SlidingWindowRateLimiter()
  const app = express()
  const httpServer = createServer(app)
  const pendingEngineAdmissions = new Map<
    IncomingMessage,
    { timer: NodeJS.Timeout; onAborted: () => void }
  >()
  const releaseEngineAdmission = (request: IncomingMessage): void => {
    const admission = pendingEngineAdmissions.get(request)
    if (!admission) return
    clearTimeout(admission.timer)
    request.off("aborted", admission.onAborted)
    pendingEngineAdmissions.delete(request)
  }
  const reserveEngineAdmission = (request: IncomingMessage): void => {
    const onAborted = (): void => releaseEngineAdmission(request)
    const timer = setTimeout(() => releaseEngineAdmission(request), ENGINE_ADMISSION_TIMEOUT_MS)
    timer.unref()
    pendingEngineAdmissions.set(request, { timer, onAborted })
    request.once("aborted", onAborted)
  }
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
    allowRequest(request, callback) {
      const origin = request.headers.origin
      if (origin && !allowedOrigins.includes(origin)) {
        callback("Origin is not allowed", false)
        return
      }
      if (io.engine.clientsCount + pendingEngineAdmissions.size >= maxSocketConnections) {
        callback("The multiplayer server is at connection capacity", false)
        return
      }
      reserveEngineAdmission(request)
      callback(null, true)
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60_000,
      skipMiddlewares: false,
    },
  })
  io.engine.on("connection", (engineSocket) => {
    releaseEngineAdmission(engineSocket.request)
    // The reservation makes concurrent admission deterministic. This final
    // check also closes a pathological handshake that outlives its reservation.
    if (io.engine.clientsCount > maxSocketConnections) engineSocket.close(true)
  })
  io.engine.on("connection_error", ({ req }: { req?: IncomingMessage }) => {
    if (req) releaseEngineAdmission(req)
  })

  let ready = false
  let acceptingOnlineActions = false
  let started = false
  let stopping: Promise<void> | null = null
  let tickTimer: NodeJS.Timeout | null = null
  let tickRunning: Promise<void> | null = null
  let recoveryTimer: NodeJS.Timeout | null = null
  let recoveryRunning: Promise<void> | null = null
  const inFlightOperations = new Set<Promise<unknown>>()

  const trackOperation = <T>(operation: Promise<T>): Promise<T> => {
    inFlightOperations.add(operation)
    void operation.then(
      () => inFlightOperations.delete(operation),
      () => inFlightOperations.delete(operation),
    )
    return operation
  }

  const drainInFlightOperations = async (): Promise<void> => {
    while (inFlightOperations.size > 0) {
      await Promise.allSettled([...inFlightOperations])
    }
  }

  const serviceUnavailableError = (): GameServerError =>
    new GameServerError("INTERNAL_ERROR", "The multiplayer server is still restoring saved games", true)

  if (process.env.TRUST_PROXY !== undefined) {
    app.set("trust proxy", parseTrustProxySetting(process.env.TRUST_PROXY))
  }
  app.disable("x-powered-by")
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  )
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true)
        else callback(new GameServerError("UNAUTHORIZED", "Origin is not allowed"))
      },
      methods: ["GET", "POST", "OPTIONS"],
      maxAge: 86_400,
    }),
  )
  app.use(express.json({ limit: "16kb", strict: true }))

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, uptimeSeconds: Math.floor(process.uptime()) })
  })

  app.get("/readyz", (_request, response) => {
    const stats = roomManager.stats()
    const persistence =
      stats.snapshotStore === "redis"
        ? "durable"
        : stats.snapshotStore === "memory-fallback"
          ? "degraded"
          : "ephemeral"
    response.status(ready ? 200 : 503).json({
      ok: ready,
      degraded: persistence === "degraded",
      persistence,
      ...stats,
    })
  })

  app.post("/v1/session/anonymous", (request, response) => {
    if (!acceptingOnlineActions) {
      response.setHeader("Retry-After", "5")
      response.status(503).json({ error: toProtocolError(serviceUnavailableError()) })
      return
    }
    const key = `session:${request.ip ?? request.socket.remoteAddress ?? "unknown"}`
    const decision = limiter.consume(key, SESSION_RATE)
    if (!decision.allowed) {
      response.setHeader("Retry-After", Math.ceil(decision.retryAfterMs / 1000))
      response.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many session requests", retryable: true },
      })
      return
    }
    const parsed = AnonymousSessionInputSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "INVALID_INPUT", message: "Choose a valid display name and avatar", retryable: false },
      })
      return
    }
    response.status(201).json(sessionTokens.createAnonymousSession(parsed.data, now()).response)
  })

  if (clientDistDir && existsSync(clientDistDir)) {
    const publicDocuments = [
      { paths: ["/privacy", "/privacy/"], file: resolve(clientDistDir, "privacy", "index.html") },
      { paths: ["/support", "/support/"], file: resolve(clientDistDir, "support", "index.html") },
      {
        paths: ["/.well-known/assetlinks.json"],
        file: resolve(clientDistDir, ".well-known", "assetlinks.json"),
      },
      {
        paths: ["/.well-known/apple-app-site-association"],
        file: resolve(clientDistDir, ".well-known", "apple-app-site-association"),
        contentType: "application/json",
      },
    ]
    for (const publicDocument of publicDocuments) {
      if (!existsSync(publicDocument.file)) continue
      app.get(publicDocument.paths, (_request, response) => {
        response.setHeader("Cache-Control", production ? "public, max-age=300" : "no-cache")
        if (publicDocument.contentType) response.type(publicDocument.contentType)
        response.sendFile(publicDocument.file, { dotfiles: "allow" })
      })
    }
    app.use(express.static(clientDistDir, { index: false, maxAge: production ? "1h" : 0 }))
    app.use((request, response, next) => {
      if (
        request.method !== "GET" ||
        request.path.startsWith("/v1/") ||
        request.path.startsWith("/socket.io") ||
        !request.accepts("html")
      ) {
        next()
        return
      }
      response.sendFile(resolve(clientDistDir, "index.html"))
    })
  }

  app.use((request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: `No route for ${request.method} ${request.path}` },
    })
  })

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next
    const protocolError = toProtocolError(error)
    if (protocolError.code === "INTERNAL_ERROR") logger.error("Unhandled HTTP error", error)
    response.status(protocolError.code === "UNAUTHORIZED" ? 403 : 500).json({ error: protocolError })
  })

  io.use((socket, next) => {
    try {
      if (!acceptingOnlineActions || stopping) throw serviceUnavailableError()
      if (io.sockets.sockets.size >= maxSocketConnections) {
        throw new GameServerError("RATE_LIMITED", "The multiplayer server is at connection capacity", true)
      }
      const token = socket.handshake.auth?.token
      if (typeof token !== "string") throw new GameServerError("UNAUTHORIZED", "A session token is required")
      const identity = sessionTokens.verify(token, now())
      const userConnectionCount = [...io.sockets.sockets.values()].filter(
        (connectedSocket) => connectedSocket.data.userId === identity.userId,
      ).length
      if (userConnectionCount >= maxSocketConnectionsPerUser) {
        throw new GameServerError("RATE_LIMITED", "This player card is already open on too many devices", true)
      }
      socket.data = {
        userId: identity.userId,
        displayName: identity.displayName,
        avatarSeed: identity.avatarSeed,
        tokenId: identity.tokenId,
        issuedAt: identity.issuedAt,
        expiresAt: identity.expiresAt,
      }
      next()
    } catch (error) {
      const protocolError = toProtocolError(error)
      const authError = new Error(protocolError.message) as Error & { data?: unknown }
      authError.data = protocolError
      next(authError)
    }
  })

  roomManager.onRoomUpdated((roomId) => {
    const channel = roomChannel(roomId)
    for (const socket of io.sockets.sockets.values()) {
      if (!socket.rooms.has(channel)) continue
      const snapshot = roomManager.snapshotForRoom(roomId, socket.data.userId)
      if (snapshot) socket.emit("state:snapshot", snapshot)
    }
  })

  roomManager.onRoomClosed((roomId, reason) => {
    // A process replacement does not destroy the durable room. Leave clients
    // subscribed until Engine.IO closes so their normal reconnection path can
    // resume the same room on the replacement process.
    if (reason === "server_shutdown") return
    const channel = roomChannel(roomId)
    io.to(channel).emit("room:closed", { roomId, reason })
    io.in(channel).socketsLeave(channel)
  })

  roomManager.onUserRemoved((userId, roomId, reason) => {
    const channel = roomChannel(roomId)
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId !== userId || !socket.rooms.has(channel)) continue
      socket.emit("room:closed", { roomId, reason })
      void socket.leave(channel)
    }
  })

  io.on("connection", (socket) => {
    const identity = socketIdentity(socket)
    let expiryTimer: NodeJS.Timeout | null = null
    let expiryHandled = false

    const expireSession = (): void => {
      if (expiryHandled) return
      expiryHandled = true
      if (expiryTimer) clearTimeout(expiryTimer)
      expiryTimer = null
      if (!socket.connected) return
      const error = toProtocolError(new GameServerError("UNAUTHORIZED", "Session token has expired", true))
      socket.emit("server:error", { error, serverTime: now() })
      setImmediate(() => {
        if (socket.connected) socket.disconnect(true)
      })
    }

    const scheduleExpiryCheck = (): void => {
      if (expiryHandled || !socket.connected) return
      const remainingMs = identity.expiresAt - now()
      if (remainingMs <= 0) {
        expireSession()
        return
      }
      expiryTimer = setTimeout(scheduleExpiryCheck, Math.min(remainingMs, SESSION_EXPIRY_TIMER_SLICE_MS))
      expiryTimer.unref()
    }
    scheduleExpiryCheck()

    const enforceRate = (event: string, rule: RateLimitRule): void => {
      const decision = limiter.consume(`${identity.userId}:${event}`, rule)
      if (!decision.allowed) {
        throw new GameServerError(
          "RATE_LIMITED",
          `Too many requests; retry in ${Math.ceil(decision.retryAfterMs / 1000)} seconds`,
          true,
        )
      }
    }

    const run = <TInput>(
      event: string,
      rule: RateLimitRule,
      schema: ZodType<TInput>,
      rawInput: unknown,
      rawAck: AckCallback<PublicGameSnapshot> | unknown,
      action: (input: TInput) => Promise<PublicGameSnapshot>,
      joinReturnedRoom = false,
    ): Promise<void> => {
      const ack: AckCallback<PublicGameSnapshot> =
        typeof rawAck === "function" ? (rawAck as AckCallback<PublicGameSnapshot>) : () => undefined
      const operation = (async () => {
        let expiredDuringRequest = false
        try {
          if (!acceptingOnlineActions || stopping) throw serviceUnavailableError()
          if (identity.expiresAt <= now()) {
            expiredDuringRequest = true
            throw new GameServerError("UNAUTHORIZED", "Session token has expired", true)
          }
          enforceRate(event, rule)
          const parsed = schema.safeParse(rawInput)
          if (!parsed.success) throw new GameServerError("INVALID_INPUT", "The request payload is invalid")
          const snapshot = await action(parsed.data)
          if (joinReturnedRoom) await socket.join(roomChannel(snapshot.roomId))
          ack(successAck(snapshot, now()))
        } catch (error) {
          if (!(error instanceof GameServerError)) logger.error(`Socket action ${event} failed`, error)
          ack(failureAck(error, now()))
          if (expiredDuringRequest) expireSession()
        }
      })()
      return trackOperation(operation)
    }

    void trackOperation(
      roomManager
        .resume(identity, socket.id)
        .then(async (snapshot) => {
          if (snapshot) await socket.join(roomChannel(snapshot.roomId))
          socket.emit("session:ready", {
            player: {
              id: identity.userId,
              displayName: identity.displayName,
              avatarSeed: identity.avatarSeed,
            },
            serverTime: now(),
            resumedRoomId: snapshot?.roomId ?? null,
          })
          if (snapshot) socket.emit("state:snapshot", snapshot)
        })
        .catch((error) => {
          logger.error("Session resume failed", error)
          socket.emit("server:error", { error: toProtocolError(error), serverTime: now() })
        }),
    )

    socket.on("matchmaking:join", (input, ack) => {
      void run(
        "matchmaking:join",
        JOIN_RATE,
        MatchmakingJoinInputSchema,
        input,
        ack,
        (parsed) => roomManager.joinMatchmaking(identity, socket.id, parsed),
        true,
      )
    })

    socket.on("private:create", (input, ack) => {
      void run(
        "private:create",
        JOIN_RATE,
        PrivateCreateInputSchema,
        input,
        ack,
        (parsed) => roomManager.createPrivateRoom(identity, socket.id, parsed),
        true,
      )
    })

    socket.on("private:join", (input, ack) => {
      void run(
        "private:join",
        JOIN_RATE,
        PrivateJoinInputSchema,
        input,
        ack,
        (parsed) => roomManager.joinPrivateRoom(identity, socket.id, parsed),
        true,
      )
    })

    socket.on("room:start", (input, ack) => {
      void run("room:start", ACTION_RATE, RoomStartInputSchema, input, ack, (parsed) =>
        roomManager.startHostedGame(identity.userId, parsed.commandId),
      )
    })

    // Older app builds used this private-named event for the same host action.
    socket.on("private:start", (input, ack) => {
      void run("private:start", ACTION_RATE, PrivateStartInputSchema, input, ack, (parsed) =>
        roomManager.startHostedGame(identity.userId, parsed.commandId),
      )
    })

    socket.on("state:sync", (input, ack) => {
      void run("state:sync", SYNC_RATE, StateSyncInputSchema, input, ack, () => roomManager.sync(identity.userId))
    })

    socket.on("game:select-target", (input, ack) => {
      void run("game:select-target", ACTION_RATE, SelectTargetInputSchema, input, ack, (parsed) =>
        roomManager.selectTarget(identity.userId, parsed),
      )
    })

    socket.on("game:pick-card", (input, ack) => {
      void run("game:pick-card", ACTION_RATE, PickCardInputSchema, input, ack, (parsed) =>
        roomManager.pickCard(identity.userId, parsed),
      )
    })

    socket.on("game:rematch-vote", (input, ack) => {
      void run("game:rematch-vote", ACTION_RATE, RematchVoteInputSchema, input, ack, (parsed) =>
        roomManager.voteRematch(identity.userId, parsed),
      )
    })

    socket.on("reaction:send", (input, ack) => {
      void run("reaction:send", REACTION_RATE, ReactionInputSchema, input, ack, (parsed) =>
        roomManager.addReaction(identity.userId, parsed.commandId, parsed.emoji),
      )
    })

    socket.on("room:leave", (input, ack) => {
      void run("room:leave", ACTION_RATE, RoomLeaveInputSchema, input, ack, async (parsed) => {
        const snapshot = await roomManager.leave(identity.userId, parsed.commandId)
        await socket.leave(roomChannel(snapshot.roomId))
        return snapshot
      })
    })

    socket.on("disconnect", () => {
      if (expiryTimer) clearTimeout(expiryTimer)
      expiryTimer = null
      void trackOperation(
        roomManager.disconnect(identity.userId, socket.id).catch((error) => {
          logger.error("Disconnect handling failed", error)
        }),
      )
    })
  })

  const resumeRecoveredSockets = async (recoveredRoomIds: string[]): Promise<number> => {
    if (recoveredRoomIds.length === 0) return 0
    const recovered = new Set(recoveredRoomIds)
    let resumedSockets = 0

    await Promise.all(
      [...io.sockets.sockets.values()].map(async (socket) => {
        const roomId = roomManager.roomIdForUser(socket.data.userId)
        if (!socket.connected || !roomId || !recovered.has(roomId)) return

        try {
          const snapshot = await roomManager.resume(socketIdentity(socket), socket.id)
          if (!snapshot || !socket.connected) return
          await socket.join(roomChannel(snapshot.roomId))
          socket.emit("state:snapshot", snapshot)
          resumedSockets += 1
        } catch (error) {
          logger.error(`Could not resume recovered room ${roomId} for ${socket.data.userId}`, error)
        }
      }),
    )
    return resumedSockets
  }

  const recoverPersistence = async (): Promise<void> => {
    if (snapshotStore.kind !== "memory-fallback") return

    const recoveredRoomIds = await roomManager.recoverSnapshots()
    const resumedSockets = await resumeRecoveredSockets(recoveredRoomIds)
    if (snapshotStore.kind === "memory-fallback" || stopping) return

    const restoredColdStartReadiness = !ready
    ready = true
    acceptingOnlineActions = true
    logger.info("Redis snapshot persistence recovered", {
      recoveredRooms: recoveredRoomIds.length,
      resumedSockets,
      restoredColdStartReadiness,
    })
  }

  const launchRecoveryProbe = (): void => {
    if (recoveryRunning || snapshotStore.kind !== "memory-fallback") return
    const running = recoverPersistence().catch((error) => {
      logger.error("Snapshot persistence recovery probe failed", error)
    })
    recoveryRunning = running
    void running.then(() => {
      if (recoveryRunning === running) recoveryRunning = null
    })
  }

  const start = async (): Promise<void> => {
    if (started) return
    await roomManager.initialize()
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error): void => {
        httpServer.off("listening", onListening)
        reject(error)
      }
      const onListening = (): void => {
        httpServer.off("error", onError)
        resolvePromise()
      }
      httpServer.once("error", onError)
      httpServer.once("listening", onListening)
      httpServer.listen(port, host)
    })
    started = true
    ready =
      snapshotStore.kind !== "memory-fallback" || snapshotStore.hasAuthoritativeState === true
    acceptingOnlineActions = ready
    const tickIntervalMs = options.tickIntervalMs ?? integerFromEnv("TICK_INTERVAL_MS", 250)
    tickTimer = setInterval(() => {
      if (tickRunning) return
      const running = trackOperation(
        roomManager.tick().catch((error) => logger.error("Authoritative tick failed", error)),
      )
      tickRunning = running
      void running.then(() => {
        if (tickRunning === running) tickRunning = null
      })
    }, tickIntervalMs)
    tickTimer.unref()
    const recoveryIntervalMs =
      options.recoveryIntervalMs ?? Math.max(1_000, integerFromEnv("SNAPSHOT_RECOVERY_INTERVAL_MS", 5_000))
    recoveryTimer = setInterval(launchRecoveryProbe, recoveryIntervalMs)
    recoveryTimer.unref()
    if (!ready) {
      logger.warn("Game server is live but not ready until Redis snapshots are rehydrated")
    }
    logger.info(`Game server listening on http://${host}:${port}`)
  }

  const stop = async (): Promise<void> => {
    if (stopping) return stopping
    stopping = (async () => {
      ready = false
      acceptingOnlineActions = false
      if (tickTimer) clearInterval(tickTimer)
      tickTimer = null
      if (recoveryTimer) clearInterval(recoveryTimer)
      recoveryTimer = null
      await recoveryRunning
      await tickRunning
      await drainInFlightOperations()
      await roomManager.shutdown()
      for (const [request, admission] of pendingEngineAdmissions) {
        clearTimeout(admission.timer)
        request.off("aborted", admission.onAborted)
      }
      pendingEngineAdmissions.clear()
      await new Promise<void>((resolvePromise) => {
        io.close(() => resolvePromise())
      })
      await drainInFlightOperations()
      await roomManager.flush()
      if (httpServer.listening) {
        await new Promise<void>((resolvePromise, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolvePromise()))
        })
      }
      started = false
    })()
    return stopping
  }

  return { app, httpServer, io, roomManager, start, stop }
}
