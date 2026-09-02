import { afterEach, describe, expect, it, vi } from "vitest"

import type { GameSnapshot } from "./game-types"
import { DEFAULT_PREFERENCES } from "./storage"
import { MusicController, musicSceneFor } from "./music"

const game = {
  id: "g", lobbyId: "l", version: 1, phase: "select_card", currentPlayerId: "me", round: 1, roundsToWin: 2,
  message: "", cards: [], players: [
    { id: "me", displayName: "Me", avatarId: "lyra", isBot: false, isEliminated: false, roundWins: 0 },
    { id: "them", displayName: "Them", avatarId: "rowan", isBot: false, isEliminated: false, roundWins: 0 },
    { id: "other", displayName: "Other", avatarId: "mira", isBot: false, isEliminated: false, roundWins: 0 },
  ],
} satisfies GameSnapshot

describe("music scene selection", () => {
  it("maps every app area to a deliberate cue", () => {
    expect(musicSceneFor("profile", undefined)).toBe("silent")
    for (const screen of ["home", "settings", "achievements", "howToPlay", "quickMatch", "privateRoom", "onlineError", "roomClosed"]) {
      expect(musicSceneFor(screen, undefined)).toBe("menu")
    }
    expect(musicSceneFor("tutorial", undefined)).toBe("tutorial")
    expect(musicSceneFor("joining", undefined)).toBe("lobby")
    expect(musicSceneFor("lobby", undefined)).toBe("lobby")
  })

  it("keeps one gameplay cue through quick turns and changes only at match point", () => {
    expect(musicSceneFor("tutorial", undefined)).toBe("tutorial")
    expect(musicSceneFor("lobby", undefined)).toBe("lobby")
    expect(musicSceneFor("game", { ...game, turnDeadlineAt: 20_000 })).toBe("game")
    expect(musicSceneFor("game", { ...game, turnDeadlineAt: 500 })).toBe("game")
    expect(musicSceneFor("game", {
      ...game,
      phase: "round_end",
      players: game.players.map((player, index) => ({ ...player, roundWins: index === 1 ? 1 : 0 })),
    })).toBe("panic")
    expect(musicSceneFor("game", { ...game, phase: "series_end" })).toBe("victory")
  })

  it("starts the casual menu theme without a gesture in the native app", () => {
    const created: Array<{ src: string; play: ReturnType<typeof vi.fn> }> = []
    class AudioMock {
      loop = false
      preload = ""
      volume = 0
      paused = true
      readonly play = vi.fn(async () => { this.paused = false })
      pause(): void { this.paused = true }
      constructor(readonly src: string) { created.push(this) }
    }
    vi.stubGlobal("Audio", AudioMock)

    const controller = new MusicController(true)
    controller.configure(DEFAULT_PREFERENCES)
    controller.installUnlockListener()
    controller.setScene("menu")

    expect(created).toHaveLength(1)
    expect(created[0].src).toBe("/assets/music/menu.mp3")
    expect(created[0].play).toHaveBeenCalledOnce()
  })

  it("discards a stale cue when a newer screen loads first", async () => {
    const pending: Array<() => void> = []
    const created: Array<{ src: string; paused: boolean }> = []
    class DeferredAudioMock {
      loop = false
      preload = ""
      volume = 0
      paused = true
      play(): Promise<void> {
        this.paused = false
        return new Promise((resolve) => pending.push(resolve))
      }
      pause(): void { this.paused = true }
      constructor(readonly src: string) { created.push(this) }
    }
    vi.stubGlobal("Audio", DeferredAudioMock)

    const controller = new MusicController(true)
    controller.configure(DEFAULT_PREFERENCES)
    controller.installUnlockListener()
    controller.setScene("game")
    controller.setScene("menu")

    pending[1]()
    await Promise.resolve()
    pending[0]()
    await Promise.resolve()

    expect(created.map((audio) => audio.src)).toEqual(["/assets/music/game.mp3", "/assets/music/menu.mp3"])
    expect(created[0].paused).toBe(true)
    expect(created[1].paused).toBe(false)
  })

  it("silences every track when exiting during a crossfade", async () => {
    const created: TransitionAudioMock[] = []
    class TransitionAudioMock {
      loop = false
      preload = ""
      volume = 0
      paused = true
      ended = false
      async play(): Promise<void> { this.paused = false }
      pause(): void { this.paused = true }
      constructor(readonly src: string) { created.push(this) }
    }

    const controller = new MusicController(true)
    controller.configure(DEFAULT_PREFERENCES)
    controller.installUnlockListener()
    const animation = installAnimationFrameMock()
    vi.stubGlobal("Audio", TransitionAudioMock)

    controller.setScene("game")
    await Promise.resolve()
    controller.setScene("menu")
    await Promise.resolve()
    expect(created.every((audio) => !audio.paused)).toBe(true)

    controller.setScene("silent")
    expect(created.every((audio) => audio.paused)).toBe(true)
    expect(animation.pending()).toBe(0)
  })

  it("retires all superseded cues after rapid victory, rematch, and Home transitions", async () => {
    const created: TransitionAudioMock[] = []
    class TransitionAudioMock {
      loop = false
      preload = ""
      volume = 0
      paused = true
      ended = false
      async play(): Promise<void> { this.paused = false }
      pause(): void { this.paused = true }
      constructor(readonly src: string) { created.push(this) }
    }

    const controller = new MusicController(true)
    controller.configure(DEFAULT_PREFERENCES)
    controller.installUnlockListener()
    const animation = installAnimationFrameMock()
    vi.stubGlobal("Audio", TransitionAudioMock)

    for (const scene of ["game", "victory", "game", "menu"] as const) {
      controller.setScene(scene)
      await Promise.resolve()
    }
    animation.finishLatest()

    expect(created.map((audio) => audio.src)).toEqual([
      "/assets/music/game.mp3",
      "/assets/music/victory.mp3",
      "/assets/music/game.mp3",
      "/assets/music/menu.mp3",
    ])
    expect(created.slice(0, -1).every((audio) => audio.paused)).toBe(true)
    expect(created.at(-1)?.paused).toBe(false)
  })

  it("does not replay the one-shot victory cue on later taps or resume events", async () => {
    const created: VictoryAudioMock[] = []
    class VictoryAudioMock {
      loop = false
      preload = ""
      volume = 0
      paused = true
      ended = false
      readonly play = vi.fn(async () => { this.paused = false })
      pause(): void { this.paused = true }
      constructor(readonly src: string) { created.push(this) }
    }
    vi.stubGlobal("Audio", VictoryAudioMock)

    const controller = new MusicController(true)
    controller.configure(DEFAULT_PREFERENCES)
    controller.installUnlockListener()
    controller.setScene("victory")
    await Promise.resolve()
    created[0].ended = true
    created[0].paused = true

    controller.resume()
    expect(created[0].play).toHaveBeenCalledOnce()
  })
})

function installAnimationFrameMock() {
  let nextId = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.stubGlobal("window", {
    requestAnimationFrame(callback: FrameRequestCallback) {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    },
    cancelAnimationFrame(id: number) { callbacks.delete(id) },
  })
  return {
    pending: () => callbacks.size,
    finishLatest() {
      const latest = [...callbacks.entries()].at(-1)
      if (!latest) throw new Error("Expected a pending animation frame")
      callbacks.delete(latest[0])
      latest[1](performance.now() + 1_000)
    },
  }
}

afterEach(() => vi.unstubAllGlobals())
