import { AVATARS } from "./avatars"
import type {
  GameCardSnapshot,
  GameEventKind,
  GamePlayerSnapshot,
  GameSnapshot,
  PlayerProfile,
} from "./game-types"

type SoloListener = (snapshot: GameSnapshot) => void

const TURN_DURATION_MS = 20_000
const START_DURATION_MS = 1_500
const REVEAL_DURATION_MS = 2_250
const SHUFFLE_DURATION_MS = 1_000
const ELIMINATION_DURATION_MS = 1_750

const BOT_NAMES = ["Pip", "Marlow", "Juniper", "Nova", "Clover", "Mochi", "Tansy"]

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return copy
}

function moveEveryCard<T extends { id: string; position: number }>(items: readonly T[]): T[] {
  if (items.length <= 1) return items.map((card, position) => ({ ...card, position }))

  const candidates = shuffled(items)
  const arranged: T[] = []
  const used = new Set<string>()

  function placeCard(position: number): boolean {
    if (position === candidates.length) return true
    for (const card of candidates) {
      if (used.has(card.id) || card.position === position) continue
      used.add(card.id)
      arranged[position] = card
      if (placeCard(position + 1)) return true
      used.delete(card.id)
    }
    return false
  }

  if (!placeCard(0)) throw new Error("Unable to move every solo card to a new position")
  return arranged.map((card, position) => ({ ...card, position }))
}

export class SoloGame {
  private profile: PlayerProfile
  private snapshot: GameSnapshot
  private listeners = new Set<SoloListener>()
  private timers = new Set<number>()
  private turnTimer?: number
  private cardSequence = 0
  private disposed = false

  constructor(profile: PlayerProfile) {
    this.profile = profile
    this.snapshot = this.createGame()
    this.schedule(() => this.beginTurn(this.profile.id), START_DURATION_MS)
  }

  getSnapshot = (): GameSnapshot => this.snapshot

  subscribe = (listener: SoloListener): (() => void) => {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  selectTarget(targetPlayerId: string): boolean {
    if (!this.canHumanAct("select_target")) return false
    const target = this.snapshot.players.find((player) => player.id === targetPlayerId && !player.isEliminated)
    if (!target || target.id === this.profile.id) return false
    this.setTarget(targetPlayerId)
    return true
  }

  selectCard(cardId: string): boolean {
    if (!this.canHumanAct("select_card") || !this.snapshot.targetPlayerId) return false
    const card = this.snapshot.cards.find((candidate) => candidate.id === cardId && !candidate.isRevealed)
    if (!card) return false
    this.revealCard(card.id, this.snapshot.targetPlayerId)
    return true
  }

  restart(): void {
    this.clearTimers()
    this.cardSequence = 0
    this.snapshot = this.createGame()
    this.emit()
    this.schedule(() => this.beginTurn(this.profile.id), START_DURATION_MS)
  }

  dispose(): void {
    this.disposed = true
    this.clearTimers()
    this.listeners.clear()
  }

  private createGame(): GameSnapshot {
    const usedNames = new Set([this.profile.displayName])
    const availableNames = shuffled(BOT_NAMES.filter((name) => !usedNames.has(name))).slice(0, 3)
    const availableAvatars = shuffled(AVATARS.filter((avatar) => avatar.id !== this.profile.avatarId)).slice(0, 3)
    const players: GamePlayerSnapshot[] = [
      {
        id: this.profile.id,
        displayName: this.profile.displayName,
        avatarId: this.profile.avatarId,
        isBot: false,
        isEliminated: false,
        roundWins: 0,
      },
      ...availableNames.map((displayName, index) => ({
        id: `solo-bot-${index + 1}`,
        displayName,
        avatarId: availableAvatars[index].id,
        isBot: true,
        isEliminated: false,
        roundWins: 0,
      })),
    ]
    const cards = shuffled(
      players.map((player, index): GameCardSnapshot & { ownerId: string } => ({
        id: this.nextCardId(),
        ownerId: player.id,
        position: index,
        isRevealed: false,
      })),
    ).map((card, position) => ({ ...card, position }))

    return {
      id: `solo-${Date.now()}`,
      lobbyId: "solo-game",
      version: 1,
      phase: "starting",
      players,
      cards,
      currentPlayerId: this.profile.id,
      round: 1,
      roundsToWin: 1,
      message: "After every reveal, all remaining cards move.",
      lastEvent: this.event("round", "The solo game is starting."),
    }
  }

  private canHumanAct(phase: "select_target" | "select_card"): boolean {
    return (
      !this.disposed &&
      this.snapshot.phase === phase &&
      this.snapshot.currentPlayerId === this.profile.id &&
      !this.snapshot.players.find((player) => player.id === this.profile.id)?.isEliminated
    )
  }

  private beginTurn(playerId: string): void {
    if (this.disposed || this.snapshot.phase === "series_end") return
    const player = this.snapshot.players.find((candidate) => candidate.id === playerId && !candidate.isEliminated)
    if (!player) {
      this.beginTurn(this.nextAlivePlayer(playerId))
      return
    }

    this.update({
      phase: "select_target",
      currentPlayerId: playerId,
      targetPlayerId: undefined,
      pendingEliminationId: undefined,
      turnDeadlineAt: Date.now() + TURN_DURATION_MS,
      turnDurationMs: TURN_DURATION_MS,
      message: player.isBot ? `${player.displayName} is searching for a hiding place…` : "Your turn — choose someone to seek.",
      lastEvent: this.event("turn", `${player.displayName}'s turn`, player.id),
    })
    this.armTurnTimeout()

    if (player.isBot) {
      this.schedule(() => this.runBotTarget(player), 650 + Math.random() * 500)
    }
  }

  private setTarget(targetPlayerId: string): void {
    const actor = this.player(this.snapshot.currentPlayerId)
    const target = this.player(targetPlayerId)
    this.update({
      phase: "select_card",
      targetPlayerId,
      turnDeadlineAt: Date.now() + TURN_DURATION_MS,
      message: actor.isBot ? `${actor.displayName} is seeking ${target.displayName}.` : `You chose ${target.displayName}. Now pick a hiding place.`,
      lastEvent: this.event("target", `${actor.displayName} chose ${target.displayName}`, actor.id, target.id),
    })
    this.armTurnTimeout()
  }

  private runBotTarget(bot: GamePlayerSnapshot): void {
    if (this.snapshot.phase !== "select_target" || this.snapshot.currentPlayerId !== bot.id) return
    const targets = this.snapshot.players.filter((player) => !player.isEliminated && player.id !== bot.id)
    const human = targets.find((player) => player.id === this.profile.id)
    const target = human && Math.random() < 0.55 ? human : randomItem(targets)
    this.setTarget(target.id)
    this.schedule(() => this.runBotCard(bot, target.id), 700 + Math.random() * 650)
  }

  private runBotCard(bot: GamePlayerSnapshot, targetPlayerId: string): void {
    if (this.snapshot.phase !== "select_card" || this.snapshot.currentPlayerId !== bot.id) return
    this.revealCard(randomItem(this.snapshot.cards).id, targetPlayerId)
  }

  private revealCard(cardId: string, targetPlayerId: string): void {
    this.clearTurnTimer()
    const actor = this.player(this.snapshot.currentPlayerId)
    const card = this.snapshot.cards.find((candidate) => candidate.id === cardId) as
      | (GameCardSnapshot & { ownerId?: string })
      | undefined
    if (!card?.ownerId) return
    const owner = this.player(card.ownerId)
    const kind: GameEventKind = owner.id === actor.id ? "self_found" : owner.id === targetPlayerId ? "found" : "miss"
    const message =
      kind === "self_found"
        ? `${actor.displayName} found their own hiding place and triggered the trapdoor!`
        : kind === "found"
          ? `${actor.displayName} found ${owner.displayName}!`
          : `${owner.displayName} was hiding there — a miss.`

    this.update({
      phase: "revealing",
      turnDeadlineAt: undefined,
      pendingEliminationId: kind === "miss" ? undefined : owner.id,
      cards: this.snapshot.cards.map((candidate) =>
        candidate.id === cardId ? { ...candidate, isRevealed: true, revealedOwnerId: owner.id } : candidate,
      ),
      message,
      lastEvent: this.event(kind, message, actor.id, targetPlayerId, owner.id),
    })

    this.schedule(() => {
      if (kind === "miss") {
        const movedCards = moveEveryCard(
          this.snapshot.cards.map((candidate) => ({
            ...candidate,
            id: this.nextCardId(),
            isRevealed: false,
            revealedOwnerId: undefined,
          })),
        )
        this.update({
          phase: "shuffling",
          pendingEliminationId: undefined,
          cards: movedCards,
          message: "The cards moved. A new turn begins next.",
          lastEvent: this.event("shuffle", "All remaining cards moved after the reveal.", actor.id),
        })
        this.schedule(() => this.beginTurn(this.nextAlivePlayer(actor.id)), SHUFFLE_DURATION_MS)
        return
      }
      this.eliminate(owner.id, actor.id)
    }, REVEAL_DURATION_MS)
  }

  private eliminate(playerId: string, actorId: string): void {
    const eliminated = this.player(playerId)
    const remainingPlayers = this.snapshot.players.map((player) =>
      player.id === playerId ? { ...player, isEliminated: true } : player,
    )
    const remainingCards = moveEveryCard(
      this.snapshot.cards
        .filter((card) => (card as GameCardSnapshot & { ownerId?: string }).ownerId !== playerId)
        .map((card) => ({
          ...card,
          id: this.nextCardId(),
          isRevealed: false,
          revealedOwnerId: undefined,
        })),
    )
    const alive = remainingPlayers.filter((player) => !player.isEliminated)

    this.update({
      phase: "eliminating",
      pendingEliminationId: playerId,
      players: remainingPlayers,
      cards: remainingCards,
      targetPlayerId: undefined,
      message: `${eliminated.displayName} is out. The remaining cards have moved!`,
      lastEvent: this.snapshot.lastEvent,
    })
    if (alive.length === 1) {
      this.schedule(() => this.finishRound(alive[0].id), ELIMINATION_DURATION_MS)
      return
    }
    this.schedule(() => this.beginTurn(this.nextAlivePlayer(actorId)), ELIMINATION_DURATION_MS)
  }

  private finishRound(winnerId: string): void {
    const winner = this.player(winnerId)
    this.update({
      phase: "series_end",
      pendingEliminationId: undefined,
      players: this.snapshot.players.map((player) =>
        player.id === winner.id ? { ...player, roundWins: 1 } : player,
      ),
      winnerId: winner.id,
      roundWinnerId: winner.id,
      turnDeadlineAt: undefined,
      message: `${winner.displayName} wins the solo round!`,
      lastEvent: this.event("win", `${winner.displayName} wins!`, winner.id),
    })
  }

  private armTurnTimeout(): void {
    this.clearTurnTimer()
    const phaseAtArm = this.snapshot.phase
    this.turnTimer = window.setTimeout(() => {
      if (phaseAtArm === "select_target" && this.snapshot.phase === "select_target") {
        const targets = this.snapshot.players.filter(
          (player) => !player.isEliminated && player.id !== this.snapshot.currentPlayerId,
        )
        this.setTarget(randomItem(targets).id)
        return
      }
      if (phaseAtArm === "select_card" && this.snapshot.phase === "select_card" && this.snapshot.targetPlayerId) {
        this.revealCard(randomItem(this.snapshot.cards).id, this.snapshot.targetPlayerId)
      }
    }, TURN_DURATION_MS)
  }

  private nextAlivePlayer(currentId: string): string {
    const startIndex = this.snapshot.players.findIndex((player) => player.id === currentId)
    for (let offset = 1; offset <= this.snapshot.players.length; offset += 1) {
      const player = this.snapshot.players[(startIndex + offset) % this.snapshot.players.length]
      if (!player.isEliminated) return player.id
    }
    return currentId
  }

  private player(playerId: string): GamePlayerSnapshot {
    const player = this.snapshot.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new Error(`Unknown solo player: ${playerId}`)
    return player
  }

  private nextCardId(): string {
    this.cardSequence += 1
    return `solo-card-${this.cardSequence}`
  }

  private event(
    kind: GameEventKind,
    message: string,
    actorId?: string,
    targetId?: string,
    ownerId?: string,
  ) {
    return { id: `${Date.now()}-${Math.random()}`, kind, message, actorId, targetId, ownerId }
  }

  private update(patch: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, version: this.snapshot.version + 1 }
    this.emit()
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.snapshot))
  }

  private schedule(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer)
      if (!this.disposed) callback()
    }, delay)
    this.timers.add(timer)
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) window.clearTimeout(this.turnTimer)
    this.turnTimer = undefined
  }

  private clearTimers(): void {
    this.clearTurnTimer()
    this.timers.forEach((timer) => window.clearTimeout(timer))
    this.timers.clear()
  }
}
