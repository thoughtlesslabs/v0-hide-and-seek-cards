import { Capacitor } from "@capacitor/core"
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics"
import type { AppPreferences } from "./game-types"

export type FeedbackCue = "tap" | "target" | "flip" | "miss" | "found" | "turn" | "victory" | "error"

const CUES: Record<FeedbackCue, { frequency: number; duration: number; gain: number; vibration: number | number[] }> = {
  tap: { frequency: 420, duration: 0.035, gain: 0.025, vibration: 8 },
  target: { frequency: 520, duration: 0.06, gain: 0.035, vibration: 12 },
  flip: { frequency: 680, duration: 0.08, gain: 0.035, vibration: [8, 24, 8] },
  miss: { frequency: 250, duration: 0.16, gain: 0.03, vibration: 18 },
  found: { frequency: 860, duration: 0.2, gain: 0.045, vibration: [20, 30, 35] },
  turn: { frequency: 610, duration: 0.13, gain: 0.04, vibration: [14, 22, 14] },
  victory: { frequency: 980, duration: 0.35, gain: 0.05, vibration: [25, 40, 25, 40, 50] },
  error: { frequency: 180, duration: 0.18, gain: 0.04, vibration: [30, 35, 30] },
}

class FeedbackController {
  private preferences: AppPreferences | undefined
  private audioContext: AudioContext | undefined

  configure(preferences: AppPreferences): void {
    this.preferences = preferences
  }

  cue(kind: FeedbackCue): void {
    const cue = CUES[kind]
    if (this.preferences?.hapticsEnabled) {
      if (Capacitor.isNativePlatform()) {
        const nativeFeedback =
          kind === "error"
            ? Haptics.notification({ type: NotificationType.Error })
            : kind === "victory" || kind === "found"
              ? Haptics.notification({ type: NotificationType.Success })
              : Haptics.impact({ style: kind === "flip" || kind === "turn" ? ImpactStyle.Medium : ImpactStyle.Light })
        void nativeFeedback.catch(() => undefined)
      } else if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(cue.vibration)
      }
    }
    if (!this.preferences?.audioEnabled || !this.preferences.soundEnabled || typeof window === "undefined") return

    try {
      const AudioContextConstructor = window.AudioContext
      this.audioContext ??= new AudioContextConstructor()
      const context = this.audioContext
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = kind === "error" || kind === "miss" ? "triangle" : "sine"
      oscillator.frequency.setValueAtTime(cue.frequency, context.currentTime)
      gain.gain.setValueAtTime(cue.gain * this.preferences.effectsVolume, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + cue.duration)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + cue.duration)
    } catch {
      // Audio feedback is an enhancement and must never block gameplay.
    }
  }
}

export const feedback = new FeedbackController()
