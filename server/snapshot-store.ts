import { createClient } from "redis"

import { parsePersistedRoom, type PersistedRoom } from "./model"

export interface SnapshotStore {
  readonly kind: string
  readonly hasAuthoritativeState?: boolean
  loadAll(): Promise<PersistedRoom[]>
  save(room: PersistedRoom): Promise<void>
  delete(roomId: string): Promise<void>
}

function cloneRoomForStorage(room: PersistedRoom): PersistedRoom {
  const clone = JSON.parse(JSON.stringify(room)) as PersistedRoom
  clone.members = clone.members.map((member) => ({ ...member, activeSocketIds: [] }))
  return clone
}

function parseStoredRoom(value: unknown): PersistedRoom | null {
  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value
    return parsePersistedRoom(parsed)
  } catch {
    return null
  }
}

export class InMemorySnapshotStore implements SnapshotStore {
  readonly kind = "memory"
  private readonly rooms = new Map<string, PersistedRoom>()

  async loadAll(): Promise<PersistedRoom[]> {
    return [...this.rooms.values()].map(cloneRoomForStorage)
  }

  async save(room: PersistedRoom): Promise<void> {
    this.rooms.set(room.id, cloneRoomForStorage(room))
  }

  async delete(roomId: string): Promise<void> {
    this.rooms.delete(roomId)
  }
}

export interface RedisSnapshotStoreOptions {
  url: string
  prefix?: string
  ttlSeconds?: number
  operationTimeoutMs?: number
  onError?: (error: unknown) => void
  client?: ReturnType<typeof createClient>
}

const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 2_000

export class RedisSnapshotStore implements SnapshotStore {
  readonly kind = "redis"
  private readonly redis: ReturnType<typeof createClient>
  private readonly prefix: string
  private readonly ttlSeconds: number
  private readonly operationTimeoutMs: number
  private readonly onError?: (error: unknown) => void
  private connecting: Promise<void> | null = null

  constructor(options: RedisSnapshotStoreOptions) {
    this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_REDIS_OPERATION_TIMEOUT_MS
    if (!Number.isSafeInteger(this.operationTimeoutMs) || this.operationTimeoutMs <= 0) {
      throw new Error("REDIS_OPERATION_TIMEOUT_MS must be a positive safe integer")
    }
    this.redis =
      options.client ??
      createClient({
        url: options.url,
        socket: { connectTimeout: this.operationTimeoutMs, reconnectStrategy: false },
      })
    this.onError = options.onError
    this.redis.on("error", (error) => this.reportError(error))
    this.prefix = options.prefix ?? "hide-seek:v1"
    this.ttlSeconds = options.ttlSeconds ?? 24 * 60 * 60
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new Error("GAME_SNAPSHOT_TTL_SECONDS must be a positive safe integer")
    }
  }

  async loadAll(): Promise<PersistedRoom[]> {
    await this.ensureConnected()
    const roomIds = await this.withOperationTimeout("load the room index", () => this.redis.sMembers(this.indexKey()))
    if (!Array.isArray(roomIds) || roomIds.length === 0) return []

    const rooms: PersistedRoom[] = []
    for (const roomId of roomIds) {
      const stored = await this.withOperationTimeout(`load room ${roomId}`, () => this.redis.get(this.roomKey(roomId)))
      const room = parseStoredRoom(stored)
      if (room?.id === roomId) rooms.push(room)
      else {
        this.reportError(new Error(`Discarding malformed Redis room snapshot ${roomId}`))
        await this.withOperationTimeout(`remove malformed room ${roomId}`, () =>
          this.redis.multi().del(this.roomKey(roomId)).sRem(this.indexKey(), roomId).exec(),
        )
      }
    }
    return rooms
  }

  async save(room: PersistedRoom): Promise<void> {
    await this.ensureConnected()
    const stored = cloneRoomForStorage(room)
    await this.withOperationTimeout(`save room ${room.id}`, () =>
      this.redis
        .multi()
        .set(this.roomKey(room.id), JSON.stringify(stored), { EX: this.ttlSeconds })
        .sAdd(this.indexKey(), room.id)
        .exec(),
    )
  }

  async delete(roomId: string): Promise<void> {
    await this.ensureConnected()
    await this.withOperationTimeout(`delete room ${roomId}`, () =>
      this.redis.multi().del(this.roomKey(roomId)).sRem(this.indexKey(), roomId).exec(),
    )
  }

  private indexKey(): string {
    return `${this.prefix}:rooms`
  }

  private roomKey(roomId: string): string {
    return `${this.prefix}:room:${roomId}`
  }

  private reportError(error: unknown): void {
    try {
      this.onError?.(error)
    } catch {
      // Snapshot recovery must not fail because an operational logger failed.
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.isOpen) return
    this.connecting ??= this.withOperationTimeout("connect to Redis", async () => {
      await this.redis.connect()
    })
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async withOperationTimeout<T>(description: string, operation: () => Promise<T>): Promise<T> {
    const timeoutError = new Error(`Redis timed out while trying to ${description}`)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(timeoutError), this.operationTimeoutMs)
      timer.unref()
    })

    try {
      return await Promise.race([Promise.resolve().then(operation), timeout])
    } catch (error) {
      if (error === timeoutError) {
        // A command may already be on the wire. Destroying this connection
        // prevents a late response from holding the command queue and ensures
        // recovery retries every pending mutation on a fresh connection.
        try {
          const destroy = (this.redis as { destroy?: () => void }).destroy
          if (typeof destroy === "function") destroy.call(this.redis)
        } catch {
          // The timeout still propagates to the resilient fallback.
        }
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

export class ResilientSnapshotStore implements SnapshotStore {
  private primaryAvailable = true
  private attemptedPrimaryLoad = false
  private loadedPrimary = false
  private readonly pending = new Map<string, PendingSnapshotMutation>()
  private nextMutationSequence = 0
  private primaryOperationTail: Promise<void> = Promise.resolve()
  private drainPromise: Promise<boolean> | null = null

  constructor(
    private readonly primary: SnapshotStore,
    private readonly fallback: InMemorySnapshotStore,
    private readonly warn: (message: string, error?: unknown) => void,
  ) {}

  get kind(): string {
    const needsInitialHydration = this.attemptedPrimaryLoad && !this.loadedPrimary
    return this.primaryAvailable && !needsInitialHydration && this.pending.size === 0
      ? this.primary.kind
      : "memory-fallback"
  }

  get hasAuthoritativeState(): boolean {
    return this.loadedPrimary
  }

  async loadAll(): Promise<PersistedRoom[]> {
    await this.drainPending()
    if (this.pending.size > 0) return this.fallback.loadAll()

    try {
      const loadedPrimary = await this.withPrimaryOperation(async () => {
        // A local mutation can be queued after the drain above but before this
        // operation acquires the lock. In that case the in-memory copy is the
        // only authoritative view until the queued drain runs.
        if (this.pending.size > 0) return false

        this.attemptedPrimaryLoad = true
        const rooms = await this.primary.loadAll()
        this.loadedPrimary = true
        this.primaryAvailable = true
        // Reconcile while still holding the primary-operation lock. Any local
        // mutation that arrives during the load remains pending, so a stale
        // primary response cannot overwrite it in the fallback.
        await this.reconcileFallback(rooms)
        return true
      })
      if (!loadedPrimary) return this.fallback.loadAll()

      return this.fallback.loadAll()
    } catch (error) {
      this.attemptedPrimaryLoad = true
      this.markPrimaryUnavailable("Redis snapshot load failed; continuing with in-memory snapshots", error)
      return this.fallback.loadAll()
    }
  }

  async save(room: PersistedRoom): Promise<void> {
    await this.fallback.save(room)
    this.pending.set(room.id, {
      kind: "save",
      sequence: ++this.nextMutationSequence,
      room: cloneRoomForStorage(room),
    })
    await this.drainPending()
  }

  async delete(roomId: string): Promise<void> {
    await this.fallback.delete(roomId)
    this.pending.set(roomId, {
      kind: "delete",
      sequence: ++this.nextMutationSequence,
      roomId,
    })
    await this.drainPending()
  }

  private async reconcileFallback(rooms: PersistedRoom[]): Promise<void> {
    const primaryRoomIds = new Set(rooms.map((room) => room.id))
    const fallbackRooms = await this.fallback.loadAll()

    for (const room of fallbackRooms) {
      if (!primaryRoomIds.has(room.id) && !this.pending.has(room.id)) {
        await this.fallback.delete(room.id)
      }
    }
    for (const room of rooms) {
      if (!this.pending.has(room.id)) await this.fallback.save(room)
    }
  }

  private async drainPending(): Promise<void> {
    while (this.pending.size > 0) {
      const completed = await (this.drainPromise ?? this.startDrain())
      if (!completed) return
    }
  }

  private startDrain(): Promise<boolean> {
    const drain = this.withPrimaryOperation(() => this.performDrain())
    this.drainPromise = drain
    const clearDrain = (): void => {
      if (this.drainPromise === drain) this.drainPromise = null
    }
    void drain.then(clearDrain, clearDrain)
    return drain
  }

  private async performDrain(): Promise<boolean> {
    while (this.pending.size > 0) {
      const entry = this.pending.entries().next().value as
        | [string, PendingSnapshotMutation]
        | undefined
      if (!entry) break

      const [roomId, mutation] = entry
      try {
        if (mutation.kind === "save") await this.primary.save(mutation.room)
        else await this.primary.delete(mutation.roomId)
      } catch (error) {
        const action = mutation.kind === "save" ? "save" : "delete"
        this.markPrimaryUnavailable(`Redis snapshot ${action} failed for room ${roomId}`, error)
        return false
      }

      // Another mutation for this room may have arrived while the primary
      // operation was in flight. Only acknowledge the exact mutation written;
      // the loop will then persist the newer desired state.
      if (this.pending.get(roomId)?.sequence === mutation.sequence) {
        this.pending.delete(roomId)
      }
    }

    this.primaryAvailable = true
    return true
  }

  private withPrimaryOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.primaryOperationTail.then(operation, operation)
    this.primaryOperationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private reportWarning(message: string, error: unknown): void {
    try {
      this.warn(message, error)
    } catch {
      // Persistence remains best-effort while degraded, including logging.
    }
  }

  private markPrimaryUnavailable(message: string, error: unknown): void {
    const firstFailure = this.primaryAvailable
    this.primaryAvailable = false
    if (firstFailure) this.reportWarning(message, error)
  }
}

type PendingSnapshotMutation =
  | { kind: "save"; sequence: number; room: PersistedRoom }
  | { kind: "delete"; sequence: number; roomId: string }

export function createSnapshotStoreFromEnv(
  warn: (message: string, error?: unknown) => void = console.warn,
  production = process.env.NODE_ENV === "production",
): SnapshotStore {
  const memory = new InMemorySnapshotStore()
  const url = process.env.GAME_REDIS_URL?.trim() || process.env.REDIS_URL?.trim()
  if (!url) {
    if (production) {
      throw new Error("GAME_REDIS_URL or REDIS_URL is required in production")
    }
    return memory
  }

  const redis = new RedisSnapshotStore({
    url,
    prefix: process.env.GAME_REDIS_PREFIX ?? "hide-seek:v1",
    ttlSeconds: Number(process.env.GAME_SNAPSHOT_TTL_SECONDS ?? "86400"),
    operationTimeoutMs: Number(process.env.REDIS_OPERATION_TIMEOUT_MS ?? DEFAULT_REDIS_OPERATION_TIMEOUT_MS),
    onError: (error) => warn("Redis client error", error),
  })
  return new ResilientSnapshotStore(redis, memory, warn)
}
