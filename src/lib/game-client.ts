import { io, type Socket } from "socket.io-client"
import { App as NativeApp } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"
import { Network } from "@capacitor/network"

import {
  PROTOCOL_VERSION,
  ProtocolErrorCodeSchema,
  type AckCallback,
  type AllowedReaction,
  type AnonymousSessionInput,
  type ClientToServerEvents,
  type ProtocolError,
  type PublicGamePhase,
  type PublicGameSnapshot,
  type ServerToClientEvents,
  type SessionResponse,
  type SocketAck,
} from "../../shared/protocol"
import { AVATARS } from "./avatars"
import type {
  GameClientError,
  GameClientState,
  GamePhase,
  GameSnapshot,
  LobbySnapshot,
  MatchOptions,
  PlayerProfile,
} from "./game-types"
import { SESSION_KEY } from "./storage"

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>
type ClientStateListener = (state: Readonly<GameClientState>) => void

interface StoredSession {
  token: string
  expiresAt: number
  profileKey: string
  protocolVersion: number
}

const ACK_TIMEOUT_MS = 8_000
const SESSION_TIMEOUT_MS = 8_000

function commandId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function serverBaseUrl(): string {
  return import.meta.env.VITE_GAME_SERVER_URL?.trim().replace(/\/$/, "") || window.location.origin
}

function profileKey(profile: PlayerProfile): string {
  return `${profile.displayName.trim().toLocaleLowerCase()}:${profile.avatarId}`
}

function readSession(profile: PlayerProfile): StoredSession | undefined {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return undefined
    const session = JSON.parse(raw) as Partial<StoredSession>
    if (
      typeof session.token !== "string" ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt <= Date.now() + 30_000 ||
      session.profileKey !== profileKey(profile) ||
      session.protocolVersion !== PROTOCOL_VERSION
    ) {
      window.localStorage.removeItem(SESSION_KEY)
      return undefined
    }
    return session as StoredSession
  } catch {
    return undefined
  }
}

function saveSession(session: SessionResponse, profile: PlayerProfile): void {
  try {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: session.token,
        expiresAt: session.expiresAt,
        profileKey: profileKey(profile),
        protocolVersion: session.protocolVersion,
      } satisfies StoredSession),
    )
  } catch {
    // A fresh anonymous session can be created if storage is unavailable.
  }
}

function removeSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage can be unavailable in an embedded webview.
  }
}

function avatarIdFromSeed(seed: string): string {
  const direct = AVATARS.find((avatar) => avatar.id === seed)
  if (direct) return direct.id
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  return AVATARS[hash % AVATARS.length].id
}

function mapPhase(phase: PublicGamePhase): GamePhase {
  switch (phase) {
    case "waiting":
      return "starting"
    case "reveal_result":
      return "revealing"
    case "elimination":
      return "eliminating"
    default:
      return phase
  }
}

function toLobby(snapshot: PublicGameSnapshot, localClockOffset: number): LobbySnapshot {
  return {
    id: snapshot.roomId,
    mode: snapshot.isPrivate ? "private" : "quick",
    inviteCode: snapshot.roomCode || undefined,
    hostId: snapshot.hostPlayerId || undefined,
    maxPlayers: snapshot.maxPlayers,
    roundsToWin: snapshot.roundsToWin,
    status: snapshot.phase === "waiting" ? "waiting" : "starting",
    startsAt: snapshot.deadline === null ? undefined : snapshot.deadline + localClockOffset,
    canStart: snapshot.canStart,
    players: snapshot.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      avatarId: avatarIdFromSeed(player.avatarSeed),
      isBot: player.isBot,
      isHost: player.isHost,
      isReady: player.isConnected || player.isBot,
    })),
  }
}

export function mapGameSnapshot(
  snapshot: PublicGameSnapshot,
  localClockOffset: number,
  previous?: GameSnapshot,
): GameSnapshot {
  const authoritativeDeadline = snapshot.deadline === null ? undefined : snapshot.deadline + localClockOffset
  const previousDeadline = previous?.turnDeadlineAt
  const phase = mapPhase(snapshot.phase)
  const deadline =
    snapshot.canAct && (phase === "select_target" || phase === "select_card")
      ? authoritativeDeadline
      : undefined
  const turnDurationMs =
    deadline &&
    previousDeadline &&
    previous?.currentPlayerId === snapshot.currentPlayerId &&
    previous.phase === phase
      ? previous.turnDurationMs
      : deadline
        ? Math.max(1_000, deadline - Date.now())
        : undefined

  return {
    id: snapshot.roomId,
    lobbyId: snapshot.roomId,
    version: snapshot.version,
    phase,
    players: snapshot.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      avatarId: avatarIdFromSeed(player.avatarSeed),
      isBot: player.isBot,
      isEliminated: player.isEliminated,
      roundWins: player.seriesWins,
    })),
    cards: snapshot.cards.map((card) => ({
      id: card.token,
      position: card.position,
      isRevealed: card.isRevealed,
      revealedOwnerId: card.revealedOwnerId || undefined,
    })),
    currentPlayerId: snapshot.currentPlayerId || "",
    targetPlayerId: snapshot.targetPlayerId || undefined,
    round: snapshot.currentRound,
    roundsToWin: snapshot.roundsToWin,
    turnDeadlineAt: deadline,
    turnDurationMs,
    roundWinnerId: snapshot.roundWinnerId || undefined,
    winnerId: snapshot.seriesWinnerId || undefined,
    pendingEliminationId: snapshot.pendingEliminationId || undefined,
    rematchVotes: snapshot.rematchVotes,
    reactions: snapshot.reactions,
    canAct: snapshot.canAct,
    message: snapshot.lastMessage,
    lastEvent:
      previous?.message === snapshot.lastMessage
        ? previous.lastEvent
        : {
            id: `${snapshot.version}:${snapshot.phase}`,
            kind:
              snapshot.phase === "reveal_result" || snapshot.phase === "elimination"
                ? snapshot.pendingEliminationId === snapshot.currentPlayerId
                  ? "self_found"
                  : snapshot.pendingEliminationId
                    ? "found"
                    : "miss"
                : snapshot.phase === "series_end"
                  ? "win"
                  : snapshot.phase === "shuffling"
                    ? "shuffle"
                    : snapshot.phase === "starting" || snapshot.phase === "round_end"
                      ? "round"
                    : "turn",
            message: snapshot.lastMessage,
            actorId: snapshot.currentPlayerId || undefined,
            targetId: snapshot.targetPlayerId || undefined,
            ownerId: snapshot.pendingEliminationId || snapshot.cards.find((card) => card.isRevealed)?.revealedOwnerId || undefined,
          },
  }
}

function clientError(error: ProtocolError): GameClientError {
  return {
    code: error.code,
    message: error.message,
    recoverable: error.retryable,
  }
}

function protocolErrorFromSocket(error: Error): ProtocolError | undefined {
  const data = (error as Error & { data?: unknown }).data
  if (!data || typeof data !== "object") return undefined
  const candidate = data as Partial<ProtocolError>
  const code = ProtocolErrorCodeSchema.safeParse(candidate.code)
  if (!code.success || typeof candidate.message !== "string" || typeof candidate.retryable !== "boolean") {
    return undefined
  }
  return { code: code.data, message: candidate.message, retryable: candidate.retryable }
}

export function shouldApplySnapshot(
  current: PublicGameSnapshot | undefined,
  incoming: PublicGameSnapshot,
  source: "push" | "ack" = "push",
): boolean {
  if (!current) return true
  if (current.roomId !== incoming.roomId || incoming.version < current.version) return false
  return source === "push" || incoming.version > current.version
}

export class GameClient {
  private socket?: TypedSocket
  private profile?: PlayerProfile
  private token?: string
  private connectPromise?: Promise<boolean>
  private leavePromise?: Promise<boolean>
  private sessionAbortController?: AbortController
  private serverClockOffset?: number
  private connectionGeneration = 0
  private pendingCommandCancels = new Set<() => void>()
  private ignoredRoomIds = new Set<string>()
  private state: GameClientState = {
    connection: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "idle",
  }
  private listeners = new Set<ClientStateListener>()

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline)
      window.addEventListener("offline", this.handleOffline)
      document.addEventListener("visibilitychange", this.handleVisibilityChange)
    }
    if (Capacitor.isNativePlatform()) this.setupNativeLifecycle()
  }

  getSnapshot = (): Readonly<GameClientState> => this.state

  subscribe = (listener: ClientStateListener): (() => void) => {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  async connect(profile: PlayerProfile): Promise<boolean> {
    const operationGeneration = this.connectionGeneration
    this.profile = profile
    if (this.leavePromise) {
      await this.leavePromise
      if (operationGeneration !== this.connectionGeneration || this.profile !== profile) return false
    }
    if (this.connectPromise) return this.connectPromise
    if (this.socket?.connected && this.state.connection === "connected") return true
    if (!navigator.onLine) {
      this.setState({ connection: "offline" })
      return false
    }

    if (this.socket) this.stopTransport()
    const generation = this.connectionGeneration
    this.connectPromise = this.open(profile, generation).finally(() => {
      if (generation === this.connectionGeneration) this.connectPromise = undefined
    })
    return this.connectPromise
  }

  async retry(): Promise<boolean> {
    const profile = this.profile
    if (!profile) return false
    const operationGeneration = this.connectionGeneration
    if (this.leavePromise) {
      await this.leavePromise
      if (operationGeneration !== this.connectionGeneration || this.profile !== profile) return false
    }
    this.stopTransport()
    return this.connect(profile)
  }

  clearError(): void {
    if (this.state.error) this.setState({ error: undefined })
  }

  disconnect({ forgetProfile = false }: { forgetProfile?: boolean } = {}): void {
    this.stopTransport()
    this.serverSnapshot = undefined
    if (forgetProfile) this.profile = undefined
    this.setState({ connection: "idle", selfPlayerId: undefined, lobby: undefined, game: undefined, error: undefined })
  }

  cancelPendingJoin(): void {
    const socket = this.socket
    this.connectionGeneration += 1
    this.sessionAbortController?.abort()
    this.sessionAbortController = undefined
    for (const cancel of [...this.pendingCommandCancels]) cancel()
    this.socket = undefined
    this.connectPromise = undefined
    this.token = undefined
    this.serverClockOffset = undefined
    removeSession()
    this.serverSnapshot = undefined
    this.setState({
      connection: navigator.onLine ? "idle" : "offline",
      selfPlayerId: undefined,
      lobby: undefined,
      game: undefined,
      error: undefined,
    })

    if (!socket?.connected) {
      socket?.disconnect()
      return
    }

    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      socket.disconnect()
    }
    const timeout = window.setTimeout(close, 750)
    socket.emit("room:leave", { commandId: commandId() }, () => {
      window.clearTimeout(timeout)
      close()
    })
  }

  async joinQuick(profile: PlayerProfile, options: MatchOptions): Promise<boolean> {
    if (!(await this.connectForAction(profile))) return false
    return this.emitCommand("matchmaking:join", { commandId: commandId(), ...options })
  }

  async createPrivate(profile: PlayerProfile, options: MatchOptions): Promise<boolean> {
    if (!(await this.connectForAction(profile))) return false
    return this.emitCommand("private:create", { commandId: commandId(), ...options })
  }

  async joinPrivate(profile: PlayerProfile, roomCode: string): Promise<boolean> {
    if (!(await this.connectForAction(profile))) return false
    return this.emitCommand("private:join", { commandId: commandId(), roomCode: roomCode.trim().toUpperCase() })
  }

  startGame(): Promise<boolean> {
    return this.emitCommand("room:start", { commandId: commandId() })
  }

  leaveLobby(): Promise<boolean> {
    if (this.leavePromise) return this.leavePromise
    const roomId = this.serverSnapshot?.roomId || this.state.lobby?.id || this.state.game?.id
    const hadRoom = Boolean(this.serverSnapshot || this.state.lobby || this.state.game)
    if (roomId) this.ignoreRoom(roomId)
    if (hadRoom) this.setState({ lobby: undefined, game: undefined, error: undefined })
    const leaving = this.completeLeave(hadRoom).finally(() => {
      if (this.leavePromise === leaving) this.leavePromise = undefined
    })
    this.leavePromise = leaving
    return leaving
  }

  private async completeLeave(hadRoom: boolean): Promise<boolean> {
    const accepted = await this.emitCommand("room:leave", { commandId: commandId() }, false)
    this.serverSnapshot = undefined
    if (!accepted && hadRoom) {
      this.stopTransport()
      removeSession()
      this.setState({
        connection: navigator.onLine ? "idle" : "offline",
        selfPlayerId: undefined,
        lobby: undefined,
        game: undefined,
        error: undefined,
      })
      return true
    }
    return accepted || hadRoom
  }

  selectTarget(targetPlayerId: string): Promise<boolean> {
    const snapshot = this.state.game
    const turnId = this.serverSnapshot?.turnId
    if (!snapshot || !turnId) return Promise.resolve(false)
    return this.emitCommand("game:select-target", {
      commandId: commandId(),
      expectedVersion: snapshot.version,
      turnId,
      targetPlayerId,
    })
  }

  selectCard(cardToken: string): Promise<boolean> {
    const snapshot = this.state.game
    const turnId = this.serverSnapshot?.turnId
    if (!snapshot || !turnId) return Promise.resolve(false)
    return this.emitCommand("game:pick-card", {
      commandId: commandId(),
      expectedVersion: snapshot.version,
      turnId,
      cardToken,
    })
  }

  voteRematch(): Promise<boolean> {
    if (!this.state.game) return Promise.resolve(false)
    return this.emitCommand("game:rematch-vote", {
      commandId: commandId(),
      expectedVersion: this.state.game.version,
    })
  }

  sendReaction(emoji: AllowedReaction): Promise<boolean> {
    return this.emitCommand("reaction:send", { commandId: commandId(), emoji })
  }

  leaveGame(): Promise<boolean> {
    return this.leaveLobby()
  }

  requestState(): Promise<boolean> {
    return this.emitCommand("state:sync", { knownVersion: this.state.game?.version }, true, false)
  }

  private serverSnapshot?: PublicGameSnapshot

  private async connectForAction(profile: PlayerProfile): Promise<boolean> {
    if (await this.connect(profile)) return true
    if (this.state.error?.code !== "UNAUTHORIZED") return false
    return this.retry()
  }

  private async open(profile: PlayerProfile, generation: number): Promise<boolean> {
    this.setState({ connection: this.state.connection === "idle" ? "connecting" : "reconnecting", error: undefined })
    try {
      let session = readSession(profile)
      if (!session) {
        const sessionInput = {
          displayName: profile.displayName,
          avatarSeed: profile.avatarId,
        } satisfies AnonymousSessionInput
        const controller = new AbortController()
        this.sessionAbortController = controller
        const timeout = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS)
        try {
          const response = await fetch(`${serverBaseUrl()}/v1/session/anonymous`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(sessionInput),
            signal: controller.signal,
          })
          if (generation !== this.connectionGeneration || this.profile !== profile) return false
          if (!response.ok) {
            let responseError: { error?: Partial<ProtocolError> } | undefined
            try {
              responseError = (await response.json()) as { error?: Partial<ProtocolError> }
            } catch {
              responseError = undefined
            }
            const invalidInput = response.status === 400 || responseError?.error?.code === "INVALID_INPUT"
            const rateLimited = response.status === 429 || responseError?.error?.code === "RATE_LIMITED"
            const responseMessage =
              typeof responseError?.error?.message === "string" ? responseError.error.message : undefined
            this.setState({
              connection: "error",
              error: invalidInput
                ? {
                    code: "INVALID_INPUT",
                    message: "Update your player name before using online play.",
                    recoverable: false,
                  }
                : rateLimited
                  ? {
                      code: "RATE_LIMITED",
                      message: "Too many connection attempts. Wait a moment and try again.",
                      recoverable: true,
                    }
                  : {
                      code: responseError?.error?.code || "CONNECTION_FAILED",
                      message: responseMessage || "The multiplayer server couldn't create a session.",
                      recoverable: responseError?.error?.retryable !== false,
                    },
            })
            return false
          }
          const created = (await response.json()) as SessionResponse
          if (generation !== this.connectionGeneration || this.profile !== profile) return false
          if (created.protocolVersion !== PROTOCOL_VERSION) {
            this.rejectIncompatibleProtocol()
            return false
          }
          session = {
            token: created.token,
            expiresAt: created.expiresAt,
            profileKey: profileKey(profile),
            protocolVersion: created.protocolVersion,
          }
          saveSession(created, profile)
          this.setState({ selfPlayerId: created.player.id })
        } finally {
          window.clearTimeout(timeout)
          if (this.sessionAbortController === controller) this.sessionAbortController = undefined
        }
      }
      if (generation !== this.connectionGeneration || this.profile !== profile) return false
      this.token = session.token
      return await this.connectSocket(session.token, generation)
    } catch (error) {
      if (generation !== this.connectionGeneration || this.profile !== profile) return false
      const timedOut = error instanceof DOMException && error.name === "AbortError"
      this.setState({
        connection: navigator.onLine ? "error" : "offline",
        error: timedOut
          ? { code: "TIMEOUT", message: "The multiplayer server took too long to respond.", recoverable: true }
          : { code: "CONNECTION_FAILED", message: "We couldn't reach the multiplayer server.", recoverable: true },
      })
      return false
    }
  }

  private connectSocket(token: string, generation: number): Promise<boolean> {
    if (generation !== this.connectionGeneration) return Promise.resolve(false)

    return new Promise((resolve) => {
      const socket: TypedSocket = io(serverBaseUrl(), {
        auth: { token },
        autoConnect: false,
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 750,
        reconnectionDelayMax: 15_000,
        randomizationFactor: 0.35,
        timeout: 8_000,
      })
      this.socket = socket

      let settled = false
      const readyTimer = window.setTimeout(() => {
        if (!isCurrent()) {
          finish(false)
          return
        }
        this.setState({
          connection: "error",
          error: { code: "TIMEOUT", message: "The multiplayer server took too long to get ready.", recoverable: true },
        })
        socket.disconnect()
        this.socket = undefined
        finish(false)
      }, ACK_TIMEOUT_MS)
      const finish = (result: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(readyTimer)
        resolve(result)
      }
      const isCurrent = () => generation === this.connectionGeneration && this.socket === socket
      const refreshExpiredSession = () => {
        removeSession()
        this.setState({
          connection: navigator.onLine ? "reconnecting" : "offline",
          error: {
            code: "UNAUTHORIZED",
            message: "Your session expired. Reconnecting with a fresh player card…",
            recoverable: true,
          },
        })
        socket.disconnect()
        this.socket = undefined
        this.token = undefined
        finish(false)
        window.setTimeout(() => {
          if (generation === this.connectionGeneration && this.profile) void this.retry()
        }, 0)
      }

      socket.on("connect", () => {
        if (!isCurrent()) {
          socket.disconnect()
          finish(false)
          return
        }
      })
      socket.on("connect_error", (error) => {
        if (!isCurrent()) {
          finish(false)
          return
        }
        const structuredError = protocolErrorFromSocket(error)
        const unauthorized =
          structuredError?.code === "UNAUTHORIZED" || /token|session|credential/i.test(error.message)
        if (unauthorized) {
          refreshExpiredSession()
          return
        }
        if (structuredError && !structuredError.retryable) {
          socket.disconnect()
          this.socket = undefined
          this.setState({ connection: "error", error: clientError(structuredError) })
          finish(false)
          return
        }
        this.setState({
          connection: navigator.onLine ? "reconnecting" : "offline",
          error: structuredError ? clientError(structuredError) : undefined,
        })
        finish(false)
      })
      socket.io.on("reconnect_attempt", () => {
        if (isCurrent()) this.setState({ connection: "reconnecting" })
      })
      socket.io.on("reconnect", () => {
        if (!isCurrent()) return
        this.setState({ connection: "reconnecting", error: undefined })
      })
      socket.on("disconnect", (reason) => {
        if (!isCurrent()) {
          finish(false)
          return
        }
        if (reason !== "io client disconnect") this.setState({ connection: navigator.onLine ? "reconnecting" : "offline" })
      })
      socket.on("session:ready", (event) => {
        if (!isCurrent()) return
        this.observeServerTime(event.serverTime)
        if (!event.resumedRoomId) {
          this.serverSnapshot = undefined
          this.setState({
            selfPlayerId: event.player.id,
            connection: "connected",
            lobby: undefined,
            game: undefined,
            error: undefined,
          })
          finish(true)
          return
        }
        this.ignoredRoomIds.delete(event.resumedRoomId)
        if (this.serverSnapshot?.roomId !== event.resumedRoomId) {
          this.serverSnapshot = undefined
          this.setState({ lobby: undefined, game: undefined })
        }
        this.setState({ selfPlayerId: event.player.id, connection: "connected", error: undefined })
        void this.requestState()
        finish(true)
      })
      socket.on("state:snapshot", (snapshot) => {
        if (isCurrent()) this.applySnapshot(snapshot)
      })
      socket.on("room:closed", ({ roomId }) => {
        if (!isCurrent()) return
        this.ignoreRoom(roomId)
        this.serverSnapshot = undefined
        this.setState({ lobby: undefined, game: undefined, error: undefined })
      })
      socket.on("server:error", ({ error }) => {
        if (!isCurrent()) return
        if (error.code === "UNAUTHORIZED") {
          refreshExpiredSession()
          return
        }
        if (this.state.connection !== "connected") {
          socket.disconnect()
          this.socket = undefined
          this.setState({ connection: "error", error: clientError(error) })
          finish(false)
          return
        }
        this.setState({ error: clientError(error) })
        finish(false)
      })
      socket.connect()
    })
  }

  private emitCommand<Event extends keyof ClientToServerEvents>(
    event: Event,
    input: Parameters<ClientToServerEvents[Event]>[0],
    applySnapshot = true,
    exposeError = true,
  ): Promise<boolean> {
    const socket = this.socket
    if (!socket?.connected || this.state.connection !== "connected") {
      if (exposeError) this.setState({ error: { code: "OFFLINE", message: "Reconnect before trying that again.", recoverable: true } })
      return Promise.resolve(false)
    }

    if (exposeError && this.state.error) this.setState({ error: undefined })
    const sentAt = Date.now()

    return new Promise((resolve) => {
      let settled = false
      const settle = (result: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        this.pendingCommandCancels.delete(cancel)
        resolve(result)
      }
      const cancel = () => settle(false)
      const timer = window.setTimeout(() => {
        if (settled) return
        if (exposeError) this.setState({ error: { code: "TIMEOUT", message: "That took too long. Please try again.", recoverable: true } })
        settle(false)
      }, ACK_TIMEOUT_MS)
      this.pendingCommandCancels.add(cancel)

      const acknowledge: AckCallback<PublicGameSnapshot> = (ack: SocketAck<PublicGameSnapshot>) => {
        if (settled) return
        this.observeServerTime(ack.serverTime, (sentAt + Date.now()) / 2)
        if (ack.ok) {
          settle(applySnapshot ? this.applySnapshot(ack.data, "ack") : true)
        } else {
          if (exposeError) this.setState({ error: clientError(ack.error) })
          if (ack.error.code === "CONFLICT") void this.requestState()
          settle(false)
        }
      }

      // Socket.IO's mapped event overloads cannot preserve the generic event/input
      // relationship inside this helper, but callers remain fully typed above.
      ;(socket.emit as (name: string, value: unknown, ack: AckCallback<PublicGameSnapshot>) => TypedSocket)(
        event,
        input,
        acknowledge,
      )
    })
  }

  private applySnapshot(snapshot: PublicGameSnapshot, source: "push" | "ack" = "push"): boolean {
    if (snapshot.protocolVersion !== PROTOCOL_VERSION) {
      this.rejectIncompatibleProtocol()
      return false
    }
    if (this.ignoredRoomIds.has(snapshot.roomId)) return true
    if (!shouldApplySnapshot(this.serverSnapshot, snapshot, source)) return true
    const clockOffset = this.observeServerTime(snapshot.serverTime)
    this.serverSnapshot = snapshot
    if (snapshot.status === "waiting") {
      this.setState({
        selfPlayerId: snapshot.selfPlayerId,
        lobby: toLobby(snapshot, clockOffset),
        game: undefined,
        error: undefined,
      })
      return true
    }
    this.setState({
      selfPlayerId: snapshot.selfPlayerId,
      lobby: undefined,
      game: mapGameSnapshot(snapshot, clockOffset, this.state.game),
      error: undefined,
    })
    return true
  }

  private rejectIncompatibleProtocol(): void {
    this.socket?.disconnect()
    this.socket = undefined
    this.token = undefined
    this.serverSnapshot = undefined
    this.setState({
      connection: "error",
      lobby: undefined,
      game: undefined,
      error: {
        code: "PROTOCOL_MISMATCH",
        message: "This version can’t join the current game server. Update the app and try again.",
        recoverable: false,
      },
    })
  }

  private stopTransport(): void {
    this.connectionGeneration += 1
    this.sessionAbortController?.abort()
    this.sessionAbortController = undefined
    for (const cancel of [...this.pendingCommandCancels]) cancel()
    this.socket?.disconnect()
    this.socket = undefined
    this.connectPromise = undefined
    this.token = undefined
    this.serverClockOffset = undefined
  }

  private observeServerTime(serverTime: number, clientTime = Date.now()): number {
    const sample = clientTime - serverTime
    this.serverClockOffset =
      this.serverClockOffset === undefined ? sample : Math.min(this.serverClockOffset, sample)
    return this.serverClockOffset
  }

  private ignoreRoom(roomId: string): void {
    this.ignoredRoomIds.add(roomId)
    if (this.ignoredRoomIds.size <= 16) return
    const oldest = this.ignoredRoomIds.values().next().value
    if (oldest) this.ignoredRoomIds.delete(oldest)
  }

  private setState(patch: Partial<GameClientState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener(this.state))
  }

  private handleOnline = (): void => {
    if (this.profile) void this.retry()
    else this.setState({ connection: "idle" })
  }

  private handleOffline = (): void => this.setState({ connection: "offline" })

  private handleVisibilityChange = (): void => {
    if (
      document.visibilityState === "visible" &&
      this.socket?.connected &&
      this.state.connection === "connected"
    ) {
      void this.requestState()
    }
  }

  private setupNativeLifecycle(): void {
    void NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return
      if (this.socket?.connected) {
        if (this.state.connection === "connected") void this.requestState()
        return
      }
      if (this.profile) void this.retry()
    }).catch(() => undefined)

    void Network.addListener("networkStatusChange", ({ connected }) => {
      if (connected) this.handleOnline()
      else this.handleOffline()
    }).catch(() => undefined)
  }
}

export const gameClient = new GameClient()
