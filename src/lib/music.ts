import { Capacitor } from "@capacitor/core"
import type { AppPreferences, GameSnapshot } from "./game-types"

export type MusicScene = "silent" | "menu" | "tutorial" | "lobby" | "game" | "panic" | "victory"

const TRACKS: Record<Exclude<MusicScene, "silent">, string> = {
  menu: "/assets/music/menu.mp3",
  tutorial: "/assets/music/tutorial.mp3",
  lobby: "/assets/music/lobby.mp3",
  game: "/assets/music/game.mp3",
  panic: "/assets/music/game-panic.mp3",
  victory: "/assets/music/victory.mp3",
}

export function musicSceneFor(screen: string, game: GameSnapshot | undefined): MusicScene {
  if (game?.phase === "series_end") return "victory"
  if (game) {
    const matchPoint = game.roundsToWin > 1 && game.players.some((player) => player.roundWins >= game.roundsToWin - 1)
    if (matchPoint) return "panic"
    return "game"
  }
  if (screen === "tutorial") return "tutorial"
  if (screen === "lobby" || screen === "joining") return "lobby"
  if (screen === "profile") return "silent"
  return "menu"
}

export class MusicController {
  private preferences: AppPreferences | undefined
  private scene: MusicScene = "silent"
  private active: HTMLAudioElement | undefined
  private playing = new Set<HTMLAudioElement>()
  private fadeFrame: number | undefined
  private playbackRequest = 0
  private unlocked = false
  private unlockInstalled = false

  constructor(private readonly nativePlatform = Capacitor.isNativePlatform()) {}

  configure(preferences: AppPreferences): void {
    this.preferences = preferences
    if (!preferences.audioEnabled || !preferences.musicEnabled || preferences.musicVolume <= 0) {
      this.stop()
      return
    }
    if (this.active) this.active.volume = preferences.musicVolume
    if (this.unlocked && this.scene !== "silent" && !this.active) this.start(this.scene)
  }

  installUnlockListener(): void {
    if (this.unlockInstalled) return
    this.unlockInstalled = true

    // Native shells explicitly permit ambient playback, so the home theme can
    // begin on launch instead of waiting for an unrelated gameplay tap.
    if (this.nativePlatform) this.unlocked = true
    this.resume()

    if (typeof window === "undefined") return
    const unlockAndResume = () => {
      this.unlocked = true
      this.resume()
    }
    // Keep these lightweight recovery listeners installed. Browsers can revoke
    // playback after backgrounding even though an earlier gesture succeeded.
    window.addEventListener("pointerdown", unlockAndResume, { passive: true })
    window.addEventListener("keydown", unlockAndResume)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.resume()
    })
  }

  resume(): void {
    if (
      !this.unlocked ||
      !this.preferences?.audioEnabled ||
      !this.preferences.musicEnabled ||
      this.preferences.musicVolume <= 0 ||
      this.scene === "silent"
    ) return
    if (this.active?.ended && this.scene === "victory") return
    if (!this.active || this.active.paused) this.start(this.scene)
  }

  setScene(scene: MusicScene): void {
    if (scene === this.scene) return
    this.scene = scene
    if (scene === "silent" || !this.preferences?.audioEnabled || !this.preferences.musicEnabled) {
      this.stop()
      return
    }
    if (this.unlocked) this.start(scene)
  }

  private start(scene: Exclude<MusicScene, "silent">): void {
    if (typeof Audio === "undefined" || !this.preferences?.audioEnabled || !this.preferences.musicEnabled) return
    const source = TRACKS[scene]
    if (this.active?.src.endsWith(source)) {
      if (this.active.ended && scene === "victory") return
      if (this.active.paused) {
        const current = this.active
        const request = ++this.playbackRequest
        this.playing.add(current)
        void current.play().then(() => {
          if (request !== this.playbackRequest || this.active !== current || this.scene !== scene) {
            this.pauseAndForget(current)
          }
        }).catch(() => {
          if (request === this.playbackRequest && this.active === current) this.active = undefined
          this.pauseAndForget(current)
        })
      }
      return
    }
    const request = ++this.playbackRequest
    const previous = this.active
    const next = new Audio(source)
    next.loop = scene !== "victory"
    next.preload = "auto"
    next.volume = 0
    this.playing.add(next)
    this.active = next
    void next.play().then(() => {
      if (request !== this.playbackRequest || this.active !== next || this.scene !== scene) {
        this.pauseAndForget(next)
        return
      }
      this.crossfade(next)
    }).catch(() => {
      this.pauseAndForget(next)
      if (request === this.playbackRequest && this.active === next) {
        this.active = previous && this.playing.has(previous) ? previous : undefined
      }
    })
  }

  private crossfade(next: HTMLAudioElement): void {
    if (typeof window === "undefined") {
      for (const audio of this.playing) {
        if (audio !== next) this.pauseAndForget(audio)
      }
      next.volume = this.preferences?.musicVolume ?? 0.5
      return
    }
    if (this.fadeFrame !== undefined) window.cancelAnimationFrame(this.fadeFrame)
    const started = performance.now()
    const previous = [...this.playing].filter((audio) => audio !== next)
    const previousVolumes = new Map(previous.map((audio) => [audio, audio.volume]))
    const tick = (time: number) => {
      const progress = Math.min(1, (time - started) / 650)
      next.volume = (this.preferences?.musicVolume ?? 0.5) * progress
      for (const audio of previous) audio.volume = (previousVolumes.get(audio) ?? 0) * (1 - progress)
      if (progress < 1) this.fadeFrame = window.requestAnimationFrame(tick)
      else {
        for (const audio of previous) this.pauseAndForget(audio)
        this.fadeFrame = undefined
      }
    }
    this.fadeFrame = window.requestAnimationFrame(tick)
  }

  private pauseAndForget(audio: HTMLAudioElement): void {
    audio.pause()
    this.playing.delete(audio)
  }

  private stop(): void {
    this.playbackRequest += 1
    if (this.fadeFrame !== undefined && typeof window !== "undefined") window.cancelAnimationFrame(this.fadeFrame)
    this.fadeFrame = undefined
    for (const audio of this.playing) audio.pause()
    this.playing.clear()
    this.active = undefined
  }
}

export const music = new MusicController()
