import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_ENGINE_CONFIG, createGame } from "../shared/game-engine"
import type { PersistedRoom } from "./model"

import {
  createSnapshotStoreFromEnv,
  InMemorySnapshotStore,
  RedisSnapshotStore,
  ResilientSnapshotStore,
  type SnapshotStore,
} from "./snapshot-store"

function room(id: string, revision = 1): PersistedRoom {
  return {
    schemaVersion: 1,
    id,
    code: null,
    isPrivate: false,
    hostPlayerId: null,
    status: "waiting",
    maxPlayers: 4,
    roundsToWin: 1,
    revision,
    createdAt: 1,
    updatedAt: revision,
    matchmakingDeadline: null,
    members: [],
    game: null,
    reactions: [],
    processedCommandIds: [],
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

class ControlledPrimary implements SnapshotStore {
  readonly kind = "redis"
  readonly rooms = new Map<string, PersistedRoom>()
  readonly calls: string[] = []
  available = true
  failRoomId: string | null = null
  beforeLoad: (() => Promise<void>) | null = null
  beforeSave: ((room: PersistedRoom) => Promise<void>) | null = null

  async loadAll(): Promise<PersistedRoom[]> {
    this.assertAvailable()
    const rooms = [...this.rooms.values()].map((value) => structuredClone(value))
    await this.beforeLoad?.()
    return rooms
  }

  async save(value: PersistedRoom): Promise<void> {
    this.calls.push(`save:${value.id}:${value.revision}`)
    await this.beforeSave?.(value)
    this.assertAvailable(value.id)
    this.rooms.set(value.id, structuredClone(value))
  }

  async delete(roomId: string): Promise<void> {
    this.calls.push(`delete:${roomId}`)
    this.assertAvailable(roomId)
    this.rooms.delete(roomId)
  }

  private assertAvailable(roomId?: string): void {
    if (!this.available || roomId === this.failRoomId) throw new Error("redis unavailable")
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("ResilientSnapshotStore", () => {
  it("reports Redis while healthy and memory fallback only while degraded", async () => {
    let available = true
    const primary: SnapshotStore = {
      kind: "redis",
      async loadAll() {
        if (!available) throw new Error("redis unavailable")
        return []
      },
      async save() {
        if (!available) throw new Error("redis unavailable")
      },
      async delete() {
        if (!available) throw new Error("redis unavailable")
      },
    }
    const warn = vi.fn()
    const store = new ResilientSnapshotStore(primary, new InMemorySnapshotStore(), warn)

    expect(store.kind).toBe("redis")
    await store.loadAll()
    expect(store.kind).toBe("redis")

    available = false
    await store.loadAll()
    expect(store.kind).toBe("memory-fallback")
    expect(warn).toHaveBeenCalledOnce()

    available = true
    await store.loadAll()
    expect(store.kind).toBe("redis")
  })

  it("requires a successful primary load after a cold-start outage", async () => {
    const primary = new ControlledPrimary()
    primary.rooms.set("persisted-room", room("persisted-room"))
    const store = new ResilientSnapshotStore(primary, new InMemorySnapshotStore(), vi.fn())

    primary.available = false
    expect(await store.loadAll()).toEqual([])
    expect(store.kind).toBe("memory-fallback")
    expect(store.hasAuthoritativeState).toBe(false)

    primary.available = true
    await store.save(room("new-local-room"))

    // A successful write proves connectivity, but it does not prove that the
    // process has rehydrated rooms that existed before this cold start.
    expect(store.kind).toBe("memory-fallback")
    expect(store.hasAuthoritativeState).toBe(false)

    const recovered = await store.loadAll()
    expect(recovered.map(({ id }) => id).sort()).toEqual(["new-local-room", "persisted-room"])
    expect(store.kind).toBe("redis")
    expect(store.hasAuthoritativeState).toBe(true)
  })

  it("stays degraded until every buffered room mutation has drained", async () => {
    const primary = new ControlledPrimary()
    const store = new ResilientSnapshotStore(primary, new InMemorySnapshotStore(), vi.fn())

    primary.available = false
    await store.save(room("room-a"))
    await store.save(room("room-b"))
    expect(store.kind).toBe("memory-fallback")

    primary.available = true
    primary.failRoomId = "room-b"
    await store.save(room("room-c"))

    expect(primary.rooms.has("room-a")).toBe(true)
    expect(primary.rooms.has("room-b")).toBe(false)
    expect(primary.rooms.has("room-c")).toBe(false)
    expect(store.kind).toBe("memory-fallback")

    primary.failRoomId = null
    const recovered = await store.loadAll()

    expect(recovered.map(({ id }) => id).sort()).toEqual(["room-a", "room-b", "room-c"])
    expect([...primary.rooms.keys()].sort()).toEqual(["room-a", "room-b", "room-c"])
    expect(store.kind).toBe("redis")
  })

  it("serializes concurrent writes and persists the newest same-room revision", async () => {
    const primary = new ControlledPrimary()
    const firstWriteStarted = deferred()
    const releaseFirstWrite = deferred()
    primary.beforeSave = async (value) => {
      if (value.id === "same-room" && value.revision === 1) {
        firstWriteStarted.resolve()
        await releaseFirstWrite.promise
      }
    }
    const store = new ResilientSnapshotStore(primary, new InMemorySnapshotStore(), vi.fn())

    const firstSave = store.save(room("same-room", 1))
    await firstWriteStarted.promise
    const secondSave = store.save(room("same-room", 2))
    expect(store.kind).toBe("memory-fallback")

    releaseFirstWrite.resolve()
    await Promise.all([firstSave, secondSave])

    expect(primary.calls).toEqual(["save:same-room:1", "save:same-room:2"])
    expect(primary.rooms.get("same-room")?.revision).toBe(2)
    expect(store.kind).toBe("redis")
  })

  it("does not let a concurrent stale load overwrite a queued local write", async () => {
    const primary = new ControlledPrimary()
    primary.rooms.set("same-room", room("same-room", 1))
    const loadStarted = deferred()
    const releaseLoad = deferred()
    primary.beforeLoad = async () => {
      loadStarted.resolve()
      await releaseLoad.promise
    }
    const store = new ResilientSnapshotStore(primary, new InMemorySnapshotStore(), vi.fn())

    const loading = store.loadAll()
    await loadStarted.promise
    const saving = store.save(room("same-room", 2))
    releaseLoad.resolve()

    const loadedRooms = await loading
    await saving

    expect(loadedRooms).toHaveLength(1)
    expect(loadedRooms[0]?.revision).toBe(2)
    expect(primary.rooms.get("same-room")?.revision).toBe(2)
    expect(store.kind).toBe("redis")
  })

  it("retains delete tombstones and removes stale rooms after recovery", async () => {
    const primary = new ControlledPrimary()
    primary.rooms.set("deleted-room", room("deleted-room"))
    const store = new ResilientSnapshotStore(primary, new InMemorySnapshotStore(), vi.fn())
    await store.loadAll()

    primary.available = false
    await store.delete("deleted-room")
    expect(store.kind).toBe("memory-fallback")
    expect(primary.rooms.has("deleted-room")).toBe(true)

    primary.available = true
    await store.save(room("recovery-trigger"))

    expect(primary.calls.slice(-2)).toEqual(["delete:deleted-room", "save:recovery-trigger:1"])
    expect(primary.rooms.has("deleted-room")).toBe(false)
    expect((await store.loadAll()).map(({ id }) => id)).toEqual(["recovery-trigger"])
    expect(store.kind).toBe("redis")
  })

  it("does not throw while degraded even if the warning callback throws", async () => {
    const primary = new ControlledPrimary()
    primary.available = false
    const store = new ResilientSnapshotStore(primary, new InMemorySnapshotStore(), () => {
      throw new Error("logger unavailable")
    })

    await expect(store.save(room("room-a"))).resolves.toBeUndefined()
    expect(store.kind).toBe("memory-fallback")
  })

  it("falls back promptly when a Redis write never settles", async () => {
    const neverSettles = new Promise<never>(() => undefined)
    const destroy = vi.fn()
    const transaction = {
      set() {
        return transaction
      },
      sAdd() {
        return transaction
      },
      exec() {
        return neverSettles
      },
    }
    const client = {
      isOpen: true,
      on: vi.fn(),
      destroy,
      multi: () => transaction,
    }
    const fallback = new InMemorySnapshotStore()
    const primary = new RedisSnapshotStore({
      url: "redis://unused.test",
      operationTimeoutMs: 20,
      client: client as never,
    })
    const warn = vi.fn()
    const store = new ResilientSnapshotStore(primary, fallback, warn)

    await expect(store.save(room("stalled-room"))).resolves.toBeUndefined()

    expect(store.kind).toBe("memory-fallback")
    expect((await fallback.loadAll()).map(({ id }) => id)).toEqual(["stalled-room"])
    expect(destroy).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      "Redis snapshot save failed for room stalled-room",
      expect.objectContaining({ message: expect.stringContaining("timed out") }),
    )
  })
})

describe("concrete snapshot stores", () => {
  it("never persists ephemeral transport socket IDs", async () => {
    const store = new InMemorySnapshotStore()
    const value = room("room-with-live-socket")
    value.members = [
      {
        userId: "player-1",
        displayName: "Player One",
        avatarSeed: "lyra",
        activeSocketIds: ["socket-secret-1", "socket-secret-2"],
        disconnectedAt: null,
        joinedAt: 1,
      },
    ]

    await store.save(value)

    expect((await store.loadAll())[0]?.members[0]?.activeSocketIds).toEqual([])
    expect(value.members[0]?.activeSocketIds).toEqual(["socket-secret-1", "socket-secret-2"])
  })

  it("commits each Redis room/index mutation in one transaction", async () => {
    const transactions: Array<Array<{ name: string; args: unknown[] }>> = []
    const client = {
      isOpen: true,
      on: vi.fn(),
      multi() {
        const commands: Array<{ name: string; args: unknown[] }> = []
        const transaction = {
          set(...args: unknown[]) {
            commands.push({ name: "set", args })
            return transaction
          },
          sAdd(...args: unknown[]) {
            commands.push({ name: "sAdd", args })
            return transaction
          },
          del(...args: unknown[]) {
            commands.push({ name: "del", args })
            return transaction
          },
          sRem(...args: unknown[]) {
            commands.push({ name: "sRem", args })
            return transaction
          },
          async exec() {
            transactions.push(commands)
          },
        }
        return transaction
      },
    }
    const store = new RedisSnapshotStore({
      url: "redis://unused.test",
      prefix: "test:v1",
      ttlSeconds: 60,
      client: client as never,
    })
    const value = room("atomic-room")
    value.members = [
      {
        userId: "player-1",
        displayName: "Player One",
        avatarSeed: "lyra",
        activeSocketIds: ["socket-not-durable"],
        disconnectedAt: null,
        joinedAt: 1,
      },
    ]

    await store.save(value)
    await store.delete(value.id)

    expect(transactions.map((transaction) => transaction.map(({ name }) => name))).toEqual([
      ["set", "sAdd"],
      ["del", "sRem"],
    ])
    expect(JSON.parse(transactions[0]?.[0]?.args[1] as string)).toMatchObject({
      members: [{ activeSocketIds: [] }],
    })
  })

  it("rejects invalid Redis snapshot TTL configuration", () => {
    const client = { on: vi.fn() }
    expect(
      () =>
        new RedisSnapshotStore({
          url: "redis://unused.test",
          ttlSeconds: 0,
          client: client as never,
        }),
    ).toThrow("GAME_SNAPSHOT_TTL_SECONDS must be a positive safe integer")
  })

  it("rejects an invalid Redis operation timeout", () => {
    const client = { on: vi.fn() }
    expect(
      () =>
        new RedisSnapshotStore({
          url: "redis://unused.test",
          operationTimeoutMs: 0,
          client: client as never,
        }),
    ).toThrow("REDIS_OPERATION_TIMEOUT_MS must be a positive safe integer")
  })

  it("quarantines a malformed Redis record without failing the full load", async () => {
    const transactions: string[][] = []
    const onError = vi.fn()
    const client = {
      isOpen: true,
      on: vi.fn(),
      sMembers: vi.fn().mockResolvedValue(["broken-room"]),
      get: vi.fn().mockResolvedValue(JSON.stringify({ schemaVersion: 1, id: "broken-room", members: [] })),
      multi() {
        const commands: string[] = []
        const transaction = {
          del() {
            commands.push("del")
            return transaction
          },
          sRem() {
            commands.push("sRem")
            return transaction
          },
          async exec() {
            transactions.push(commands)
          },
        }
        return transaction
      },
    }
    const store = new RedisSnapshotStore({
      url: "redis://unused.test",
      prefix: "test:v1",
      onError,
      client: client as never,
    })

    await expect(store.loadAll()).resolves.toEqual([])
    expect(transactions).toEqual([["del", "sRem"]])
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("broken-room") }))
  })

  it("loads and normalizes legacy Redis games without presentation durations", async () => {
    const value = room("legacy-active-room")
    value.status = "in_progress"
    value.members = [
      {
        userId: "player-1",
        displayName: "Player One",
        avatarSeed: "lyra",
        activeSocketIds: [],
        disconnectedAt: null,
        joinedAt: 1,
      },
      {
        userId: "player-2",
        displayName: "Player Two",
        avatarSeed: "rowan",
        activeSocketIds: [],
        disconnectedAt: null,
        joinedAt: 1,
      },
    ]
    value.game = createGame({
      gameId: value.id,
      players: value.members.map((member) => ({
        id: member.userId,
        displayName: member.displayName,
        avatarSeed: member.avatarSeed,
      })),
      roundsToWin: 1,
      now: 1,
      initialVersion: value.revision,
    })
    const legacyConfig = value.game.config as Partial<typeof value.game.config>
    delete legacyConfig.startDurationMs
    delete legacyConfig.shuffleDurationMs
    const client = {
      isOpen: true,
      on: vi.fn(),
      sMembers: vi.fn().mockResolvedValue([value.id]),
      get: vi.fn().mockResolvedValue(JSON.stringify(value)),
    }
    const store = new RedisSnapshotStore({
      url: "redis://unused.test",
      prefix: "test:v1",
      client: client as never,
    })

    const loaded = await store.loadAll()

    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.game?.config).toMatchObject({
      startDurationMs: DEFAULT_ENGINE_CONFIG.startDurationMs,
      shuffleDurationMs: DEFAULT_ENGINE_CONFIG.shuffleDurationMs,
    })
  })
})

describe("createSnapshotStoreFromEnv", () => {
  it("fails closed when production has no Redis URL", () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("GAME_REDIS_URL", "")
    vi.stubEnv("REDIS_URL", "")

    expect(() => createSnapshotStoreFromEnv(undefined, true)).toThrow(
      "GAME_REDIS_URL or REDIS_URL is required in production",
    )
  })

  it("keeps the in-memory store available outside production", () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("GAME_REDIS_URL", "")
    vi.stubEnv("REDIS_URL", "")

    expect(createSnapshotStoreFromEnv().kind).toBe("memory")
  })

  it("rejects a partially numeric snapshot TTL instead of truncating it", () => {
    vi.stubEnv("REDIS_URL", "redis://unused.test")
    vi.stubEnv("GAME_SNAPSHOT_TTL_SECONDS", "60seconds")

    expect(() => createSnapshotStoreFromEnv()).toThrow(
      "GAME_SNAPSHOT_TTL_SECONDS must be a positive safe integer",
    )
  })

  it("rejects a partially numeric Redis operation timeout", () => {
    vi.stubEnv("REDIS_URL", "redis://unused.test")
    vi.stubEnv("REDIS_OPERATION_TIMEOUT_MS", "2000milliseconds")

    expect(() => createSnapshotStoreFromEnv()).toThrow(
      "REDIS_OPERATION_TIMEOUT_MS must be a positive safe integer",
    )
  })
})
