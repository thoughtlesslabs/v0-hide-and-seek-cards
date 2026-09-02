import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { App as NativeApp, type URLOpenListenerEvent } from "@capacitor/app"
import { Capacitor, type PluginListenerHandle } from "@capacitor/core"
import { AlertTriangle, LogOut } from "lucide-react"

import { Dialog } from "./components/Dialog"
import { AchievementToast } from "./components/AchievementToast"
import { achievements } from "./lib/achievements"
import { gameClient } from "./lib/game-client"
import { feedback } from "./lib/feedback"
import { profileForGame } from "./lib/profile-identity"
import { music, musicSceneFor } from "./lib/music"
import type { AllowedReaction } from "../shared/protocol"
import { DEFAULT_MATCH_OPTIONS, type AppPreferences, type AvatarId, type GameSnapshot, type MatchOptions, type PlayerProfile } from "./lib/game-types"
import { SoloGame } from "./lib/solo-game"
import {
  clearLocalData,
  createLocalPlayerId,
  DEFAULT_PREFERENCES,
  hasCompletedTutorial,
  loadPreferences,
  loadProfile,
  savePreferences,
  saveProfile,
  saveTutorialCompleted,
} from "./lib/storage"
import { GameScreen } from "./screens/GameScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { HowToPlayScreen } from "./screens/HowToPlayScreen"
import { LobbyScreen } from "./screens/LobbyScreen"
import { PrivateRoomScreen } from "./screens/PrivateRoomScreen"
import { ProfileScreen } from "./screens/ProfileScreen"
import { QuickMatchScreen } from "./screens/QuickMatchScreen"
import { ResultScreen } from "./screens/ResultScreen"
import { SettingsScreen } from "./screens/SettingsScreen"
import { EmptyStateScreen, FatalConnectionScreen, LoadingScreen } from "./screens/StateScreens"
import { TutorialScreen } from "./screens/TutorialScreen"
import { AchievementsScreen } from "./screens/AchievementsScreen"

type Screen =
  | "profile"
  | "editProfile"
  | "home"
  | "tutorial"
  | "achievements"
  | "howToPlay"
  | "settings"
  | "quickMatch"
  | "privateRoom"
  | "joining"
  | "lobby"
  | "game"
  | "onlineError"
  | "roomClosed"

function GameAppContent() {
  const [profile, setProfile] = useState<PlayerProfile | undefined>(() => loadProfile())
  const [preferences, setPreferences] = useState<AppPreferences>(() => loadPreferences())
  const [screen, setScreen] = useState<Screen>(() => (profile ? (hasCompletedTutorial() ? "home" : "tutorial") : "profile"))
  const [pending, setPending] = useState(false)
  const [rematchPending, setRematchPending] = useState(false)
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [soloGame, setSoloGame] = useState<SoloGame | undefined>()
  const [soloSnapshot, setSoloSnapshot] = useState<GameSnapshot | undefined>()
  const [incomingRoomCode, setIncomingRoomCode] = useState<string | undefined>()
  const [quickMatchOptions, setQuickMatchOptions] = useState<MatchOptions>(DEFAULT_MATCH_OPTIONS)
  const clientState = useSyncExternalStore(gameClient.subscribe, gameClient.getSnapshot, gameClient.getSnapshot)
  const lastEventId = useRef<string | undefined>(undefined)
  const suppressPreferenceSave = useRef(false)
  const quickMatchAttempt = useRef(0)
  const privateRoomAttempt = useRef(0)
  const trackedGameId = useRef<string | undefined>(undefined)
  const completedGameId = useRef<string | undefined>(undefined)

  const activeProfile = profile
    ? profileForGame(profile, clientState.selfPlayerId, Boolean(soloGame))
    : undefined
  const activeGame = soloSnapshot || clientState.game
  const isSolo = Boolean(soloGame)
  const hasActiveGame = Boolean(activeGame)
  const hasLobby = Boolean(clientState.lobby)
  const seriesEnded = activeGame?.phase === "series_end"

  const goHome = useCallback(() => {
    soloGame?.dispose()
    setSoloGame(undefined)
    setSoloSnapshot(undefined)
    setRematchPending(false)
    if (clientState.game || clientState.lobby) void gameClient.leaveGame()
    setScreen("home")
  }, [clientState.game, clientState.lobby, soloGame])
  const viewKey = activeGame
    ? `${activeGame.id}:${activeGame.phase === "series_end" ? "results" : "game"}`
    : clientState.lobby
      ? `${clientState.lobby.id}:lobby`
      : screen

  useEffect(() => {
    feedback.configure(preferences)
    music.configure(preferences)
    music.installUnlockListener()
    if (suppressPreferenceSave.current) suppressPreferenceSave.current = false
    else savePreferences(preferences)
    const reduceMotion =
      preferences.motion === "reduced" ||
      (preferences.motion === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.documentElement.dataset.motion = reduceMotion ? "reduced" : "full"
    document.documentElement.dataset.contrast = preferences.highContrast ? "high" : "standard"
  }, [preferences])

  useEffect(() => {
    music.setScene(musicSceneFor(screen, activeGame))
  }, [activeGame, screen])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
    const frame = window.requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>("main")
      const focusTarget = main?.querySelector<HTMLElement>("h1") ?? main
      if (!focusTarget) return
      focusTarget.tabIndex = -1
      focusTarget.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [viewKey])

  useEffect(() => {
    if (!profile) return
    void gameClient.connect(profile)
  }, [profile])

  useEffect(() => {
    const openInvite = (url: string) => {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return
      }
      const pathCode = parsed.pathname.match(/\/join\/([A-HJ-NP-Z2-9]{6})(?:\/|$)/i)?.[1]
      const queryCode = parsed.searchParams.get("join")
      const code = (pathCode || queryCode || "").toUpperCase()
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return
      setIncomingRoomCode(code)
      setScreen("privateRoom")
    }

    openInvite(window.location.href)
    if (!Capacitor.isNativePlatform()) return
    let handle: PluginListenerHandle | undefined
    let disposed = false
    void NativeApp.addListener("appUrlOpen", (event: URLOpenListenerEvent) => openInvite(event.url)).then((listener) => {
      if (disposed) void listener.remove()
      else handle = listener
    })
    return () => {
      disposed = true
      void handle?.remove()
    }
  }, [])

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return
    const atSystemRoot =
      !profile ||
      screen === "profile" ||
      ((screen === "home" || screen === "tutorial") && !hasLobby && !hasActiveGame)
    if (atSystemRoot) {
      // Let Android own Back at the navigation root so the activity can close
      // through the platform's predictive-back flow. Removing the JS listener
      // alone is not enough: Capacitor's native callback otherwise still
      // consumes Back when the WebView has no history.
      void NativeApp.toggleBackButtonHandler({ enabled: false })
      return () => {
        void NativeApp.toggleBackButtonHandler({ enabled: true })
      }
    }

    void NativeApp.toggleBackButtonHandler({ enabled: true })

    let handle: PluginListenerHandle | undefined
    let disposed = false
    void NativeApp.addListener("backButton", () => {
      if (leaveDialogOpen) {
        setLeaveDialogOpen(false)
        return
      }
      if (screen === "joining") {
        quickMatchAttempt.current += 1
        gameClient.cancelPendingJoin()
        setPending(false)
        setScreen("quickMatch")
        return
      }
      if (screen === "quickMatch") {
        setScreen("home")
        return
      }
      if (screen === "privateRoom") {
        if (pending) {
          privateRoomAttempt.current += 1
          gameClient.cancelPendingJoin()
          setPending(false)
        }
        setIncomingRoomCode(undefined)
        setScreen("home")
        return
      }
      if (seriesEnded) {
        goHome()
        return
      }
      if (screen === "game" || screen === "lobby" || hasLobby || hasActiveGame) {
        setLeaveDialogOpen(true)
        return
      }
      if (screen === "editProfile") {
        setScreen("settings")
        return
      }
      setScreen("home")
    }).then((listener) => {
      if (disposed) void listener.remove()
      else handle = listener
    })
    return () => {
      disposed = true
      void handle?.remove()
    }
  }, [goHome, hasActiveGame, hasLobby, leaveDialogOpen, pending, profile, screen, seriesEnded])

  useEffect(() => {
    const event = activeGame?.lastEvent
    if (!event || event.id === lastEventId.current) return
    lastEventId.current = event.id
    if (event.kind === "miss") feedback.cue("miss")
    else if (event.kind === "found" || event.kind === "self_found") feedback.cue("found")
    else if (event.kind === "win") feedback.cue("victory")
    else if (event.kind === "target") feedback.cue("target")
    else if (event.kind === "turn" && activeGame?.currentPlayerId === activeProfile?.id) feedback.cue("turn")
    if (event.actorId === activeProfile?.id && event.kind === "found") {
      achievements.record({ type: "target_found", eventId: `found:${event.id}` })
    }
    if (event.actorId === activeProfile?.id && event.kind === "self_found") {
      achievements.record({ type: "self_found", eventId: `self:${event.id}` })
    }
    if (event.kind === "win" && activeGame?.winnerId === activeProfile?.id) {
      achievements.record({ type: "game_won", eventId: `win:${activeGame.id}` })
    }
  }, [activeGame?.currentPlayerId, activeGame?.id, activeGame?.lastEvent, activeGame?.winnerId, activeProfile?.id])

  useEffect(() => {
    if (!activeGame || trackedGameId.current === activeGame.id) return
    trackedGameId.current = activeGame.id
    achievements.record({ type: "game_started", players: activeGame.players.length, eventId: `started:${activeGame.id}` })
  }, [activeGame])

  useEffect(() => {
    if (!activeGame || activeGame.phase !== "series_end" || completedGameId.current === activeGame.id) return
    completedGameId.current = activeGame.id
    achievements.record({ type: "game_completed", eventId: `completed:${activeGame.id}` })
  }, [activeGame])

  useEffect(() => {
    if (activeGame?.phase === "series_end") return
    const timer = window.setTimeout(() => setRematchPending(false), 0)
    return () => window.clearTimeout(timer)
  }, [activeGame?.phase])

  useEffect(
    () => () => {
      soloGame?.dispose()
    },
    [soloGame],
  )

  useEffect(
    () => () => {
      gameClient.disconnect({ forgetProfile: true })
    },
    [],
  )

  function savePlayer(displayName: string, avatarId: AvatarId) {
    const nextProfile: PlayerProfile = {
      id: profile?.id || createLocalPlayerId(),
      displayName,
      avatarId,
    }
    const editing = screen === "editProfile"
    saveProfile(nextProfile)
    setProfile(nextProfile)
    feedback.cue("tap")
    if (editing) {
      gameClient.disconnect()
      setScreen("settings")
      void gameClient.connect(nextProfile)
    } else {
      setScreen(incomingRoomCode ? "privateRoom" : "tutorial")
    }
  }

  async function quickMatch(options: MatchOptions) {
    if (!profile || pending) return
    const attempt = quickMatchAttempt.current + 1
    quickMatchAttempt.current = attempt
    feedback.cue("tap")
    setQuickMatchOptions(options)
    setPending(true)
    setScreen("joining")
    const accepted = await gameClient.joinQuick(profile, options)
    if (attempt !== quickMatchAttempt.current) return
    setPending(false)
    if (accepted) setScreen("lobby")
    if (!accepted) {
      setScreen("onlineError")
      feedback.cue("error")
    }
  }

  function cancelQuickMatch() {
    quickMatchAttempt.current += 1
    gameClient.cancelPendingJoin()
    setPending(false)
    setScreen("quickMatch")
  }

  async function createPrivate(options: MatchOptions) {
    if (!profile || pending) return
    const attempt = privateRoomAttempt.current + 1
    privateRoomAttempt.current = attempt
    setPending(true)
    feedback.cue("tap")
    const accepted = await gameClient.createPrivate(profile, options)
    if (attempt !== privateRoomAttempt.current) return
    setPending(false)
    if (accepted) setScreen("lobby")
    if (!accepted) feedback.cue("error")
  }

  async function joinPrivate(code: string) {
    if (!profile || pending) return
    const attempt = privateRoomAttempt.current + 1
    privateRoomAttempt.current = attempt
    setPending(true)
    feedback.cue("tap")
    const accepted = await gameClient.joinPrivate(profile, code)
    if (attempt !== privateRoomAttempt.current) return
    setPending(false)
    if (accepted) {
      setIncomingRoomCode(undefined)
      setScreen("lobby")
    }
    if (!accepted) feedback.cue("error")
  }

  function leavePrivateRoomScreen() {
    if (pending) {
      privateRoomAttempt.current += 1
      gameClient.cancelPendingJoin()
      setPending(false)
    }
    setIncomingRoomCode(undefined)
    setScreen("home")
  }

  function startSolo() {
    if (!profile) return
    soloGame?.dispose()
    const game = new SoloGame(profile)
    game.subscribe(setSoloSnapshot)
    setSoloGame(game)
    setScreen("game")
    feedback.cue("tap")
  }

  async function leaveCurrentRoom() {
    setLeaveDialogOpen(false)
    setPending(true)
    if (soloGame) {
      soloGame.dispose()
      setSoloGame(undefined)
      setSoloSnapshot(undefined)
      setPending(false)
      setScreen("home")
      return
    }
    const leaving = gameClient.leaveGame()
    setPending(false)
    setScreen("home")
    await leaving
  }

  async function resetLocalData(): Promise<boolean> {
    if (!clearLocalData()) return false

    setPending(true)
    setLeaveDialogOpen(false)
    soloGame?.dispose()
    setSoloGame(undefined)
    setSoloSnapshot(undefined)

    if (clientState.game || clientState.lobby) {
      await gameClient.leaveGame().catch(() => false)
    }
    gameClient.disconnect({ forgetProfile: true })

    suppressPreferenceSave.current = true
    setPreferences({ ...DEFAULT_PREFERENCES })
    setIncomingRoomCode(undefined)
    setRematchPending(false)
    lastEventId.current = undefined
    trackedGameId.current = undefined
    completedGameId.current = undefined
    achievements.reset()
    setProfile(undefined)
    setScreen("profile")
    setPending(false)
    return true
  }

  async function selectTarget(playerId: string): Promise<boolean> {
    feedback.cue("target")
    return soloGame ? soloGame.selectTarget(playerId) : gameClient.selectTarget(playerId)
  }

  async function pickCard(cardId: string): Promise<boolean> {
    feedback.cue("flip")
    const accepted = soloGame ? soloGame.selectCard(cardId) : await gameClient.selectCard(cardId)
    if (accepted) achievements.record({ type: "card_flipped", eventId: `flip:${activeGame?.id}:${activeGame?.version}:${cardId}` })
    return accepted
  }

  async function rematch() {
    if (rematchPending) return
    if (soloGame) {
      soloGame.restart()
      setScreen("game")
      return
    }
    setRematchPending(true)
    const accepted = await gameClient.voteRematch()
    if (!accepted) setRematchPending(false)
  }

  if (!profile || screen === "profile") {
    return <ProfileScreen onSave={savePlayer} />
  }

  if (screen === "editProfile") {
    return (
      <ProfileScreen
        editing
        initialName={profile.displayName}
        initialAvatar={profile.avatarId}
        onSave={savePlayer}
        onCancel={() => setScreen("settings")}
      />
    )
  }

  if (screen === "tutorial") {
    const finishTutorial = (earned: boolean) => {
      saveTutorialCompleted()
      if (earned) {
        achievements.record({ type: "tutorial_complete" })
        feedback.cue("victory")
      }
      setScreen("home")
    }
    return <TutorialScreen playerName={profile.displayName} onComplete={() => finishTutorial(true)} onSkip={() => finishTutorial(false)} />
  }

  if (screen === "achievements") return <AchievementsScreen onBack={() => setScreen("home")} />

  if (screen === "howToPlay") {
    return <HowToPlayScreen onTutorial={() => setScreen("tutorial")} onBack={() => setScreen("home")} />
  }

  if (screen === "settings") {
    return (
      <SettingsScreen
        profile={profile}
        preferences={preferences}
        onChange={setPreferences}
        onEditProfile={() => setScreen("editProfile")}
        onResetLocalData={resetLocalData}
        onBack={() => setScreen("home")}
      />
    )
  }

  if (screen === "privateRoom") {
    return (
      <PrivateRoomScreen
        key={incomingRoomCode ?? "private-room"}
        connection={clientState.connection}
        error={clientState.error}
        pending={pending}
        initialCode={incomingRoomCode}
        onCreate={createPrivate}
        onJoin={joinPrivate}
        onRetry={() => void gameClient.retry()}
        onDismissError={() => gameClient.clearError()}
        onBack={leavePrivateRoomScreen}
      />
    )
  }

  if (screen === "quickMatch") {
    return (
      <QuickMatchScreen
        connection={clientState.connection}
        error={clientState.error}
        initialOptions={quickMatchOptions}
        onStart={quickMatch}
        onRetry={() => void gameClient.retry()}
        onDismissError={() => gameClient.clearError()}
        onBack={() => setScreen("home")}
      />
    )
  }

  if (screen === "joining") {
    return <LoadingScreen label="Looking for a friendly table…" onCancel={cancelQuickMatch} />
  }

  if (screen === "onlineError") {
    return (
      <FatalConnectionScreen
        onRetry={() => void quickMatch(quickMatchOptions)}
        onSolo={startSolo}
        onHome={() => setScreen("home")}
      />
    )
  }

  if (screen === "roomClosed") {
    return (
      <EmptyStateScreen
        title="That room has closed"
        message="The host may have left or the game expired. You can find another table whenever you’re ready."
        onHome={() => setScreen("home")}
      />
    )
  }

  if ((screen === "lobby" || Boolean(clientState.lobby)) && clientState.lobby && activeProfile) {
    return (
      <>
        <LobbyScreen
          profile={activeProfile}
          lobby={clientState.lobby}
          connection={clientState.connection}
          error={clientState.error}
          pending={pending}
          onStart={async () => {
            setPending(true)
            const accepted = await gameClient.startGame()
            setPending(false)
            if (accepted) setScreen("game")
            if (!accepted) feedback.cue("error")
          }}
          onLeave={() => setLeaveDialogOpen(true)}
          onRetry={() => void gameClient.retry()}
          onDismissError={() => gameClient.clearError()}
        />
        <LeaveDialog open={leaveDialogOpen} lobby onClose={() => setLeaveDialogOpen(false)} onConfirm={leaveCurrentRoom} />
      </>
    )
  }

  if ((screen === "game" || Boolean(activeGame)) && activeGame && activeProfile) {
    if (activeGame.phase === "series_end") {
      return (
        <ResultScreen
          profile={activeProfile}
          game={activeGame}
          connection={clientState.connection}
          error={clientState.error}
          solo={isSolo}
          rematchPending={rematchPending}
          onRematch={rematch}
          onHome={goHome}
          onRetry={() => void gameClient.retry()}
          onDismissError={() => gameClient.clearError()}
        />
      )
    }
    return (
      <>
        <GameScreen
          profile={activeProfile}
          game={activeGame}
          connection={clientState.connection}
          error={clientState.error}
          solo={isSolo}
          onSelectTarget={selectTarget}
          onPickCard={(cardId) => pickCard(cardId)}
          onReaction={isSolo ? undefined : (emoji) => {
            void gameClient.sendReaction(emoji as AllowedReaction).then((accepted) => {
              if (accepted) achievements.record({ type: "reaction_sent" })
            })
          }}
          onRetry={() => void gameClient.retry()}
          onDismissError={() => gameClient.clearError()}
          onLeave={() => setLeaveDialogOpen(true)}
        />
        <LeaveDialog open={leaveDialogOpen} onClose={() => setLeaveDialogOpen(false)} onConfirm={leaveCurrentRoom} />
      </>
    )
  }

  if ((screen === "lobby" || screen === "game") && !clientState.lobby && !activeGame) {
    return (
      <EmptyStateScreen
        title="That room has closed"
        message="The game may have ended while you were away. You can find another table whenever you’re ready."
        onHome={() => setScreen("home")}
      />
    )
  }

  return (
    <HomeScreen
      profile={profile}
      connection={clientState.connection}
      error={clientState.error}
      onQuickMatch={() => setScreen("quickMatch")}
      onPrivateRoom={() => setScreen("privateRoom")}
      onSolo={startSolo}
      onHowToPlay={() => setScreen("howToPlay")}
      onTutorial={() => setScreen("tutorial")}
      onAchievements={() => setScreen("achievements")}
      onSettings={() => setScreen("settings")}
      audioEnabled={preferences.audioEnabled}
      onToggleAudio={() => {
        if (preferences.audioEnabled) feedback.cue("tap")
        setPreferences((current) => ({ ...current, audioEnabled: !current.audioEnabled }))
      }}
      onRetry={() => void gameClient.retry()}
      onDismissError={() => gameClient.clearError()}
    />
  )
}

export default function GameApp() {
  return <><GameAppContent /><AchievementToast /></>
}

function LeaveDialog({
  open,
  lobby = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  lobby?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={open}
      title={lobby ? "Leave this room?" : "Leave the game?"}
      description={lobby ? "Your seat will open for someone else." : "A friendly bot may take over your seat so everyone can finish."}
      onClose={onClose}
    >
      <div className="dialog-alert"><AlertTriangle aria-hidden="true" /><span>You can always start another game from Home.</span></div>
      <div className="dialog-actions">
        <button className="button button--ghost" type="button" onClick={onClose} data-autofocus>Stay</button>
        <button className="button button--danger" type="button" onClick={onConfirm}><LogOut aria-hidden="true" />Leave</button>
      </div>
    </Dialog>
  )
}
