import type {
  AllowedReaction,
  ProtocolErrorCode,
  PublicGameSnapshot,
  PublicReaction,
} from "./protocol"
import { PROTOCOL_VERSION } from "./protocol"

export type GamePhase =
  | "starting"
  | "select_target"
  | "select_card"
  | "reveal_result"
  | "shuffling"
  | "elimination"
  | "round_end"
  | "series_end"

export interface EngineConfig {
  startDurationMs: number
  turnDurationMs: number
  botThinkDurationMs: number
  revealDurationMs: number
  shuffleDurationMs: number
  eliminationDurationMs: number
  roundEndDurationMs: number
}

export const DEFAULT_ENGINE_CONFIG: Readonly<EngineConfig> = Object.freeze({
  startDurationMs: 1_500,
  turnDurationMs: 15_000,
  botThinkDurationMs: 900,
  revealDurationMs: 2_250,
  shuffleDurationMs: 1_000,
  eliminationDurationMs: 1_750,
  roundEndDurationMs: 3_000,
})

export interface RandomSource {
  integer(maxExclusive: number): number
  id(bytes?: number): string
}

export const secureRandomSource: RandomSource = {
  integer(maxExclusive) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive safe integer")
    }
    if (maxExclusive > 0x1_0000_0000) throw new RangeError("maxExclusive exceeds the 32-bit CSPRNG range")
    const range = 0x1_0000_0000
    const rejectionLimit = Math.floor(range / maxExclusive) * maxExclusive
    const sample = new Uint32Array(1)
    do {
      globalThis.crypto.getRandomValues(sample)
    } while (sample[0] >= rejectionLimit)
    return sample[0] % maxExclusive
  },
  id(bytes = 18) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError("bytes must be a positive integer")
    const value = new Uint8Array(bytes)
    globalThis.crypto.getRandomValues(value)
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")
  },
}

/** A non-mutating Fisher-Yates shuffle backed by Node's CSPRNG by default. */
export function fisherYates<T>(values: readonly T[], random: RandomSource = secureRandomSource): T[] {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = random.integer(index + 1)
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

export interface EnginePlayerInput {
  id: string
  displayName: string
  avatarSeed: string
  isBot?: boolean
  canReconnect?: boolean
  isConnected?: boolean
}

export interface PrivatePlayerState {
  id: string
  displayName: string
  avatarSeed: string
  isBot: boolean
  canReconnect: boolean
  isConnected: boolean
  isEliminated: boolean
  seriesWins: number
}

/** This shape is server-only. Never serialize it into a client event. */
export interface PrivateCardState {
  secretId: string
  ownerId: string
  selectionToken: string
  position: number
  isRevealed: boolean
}

export interface PrivateGameState {
  gameId: string
  version: number
  roundsToWin: 1 | 2 | 3
  currentRound: number
  players: PrivatePlayerState[]
  cards: PrivateCardState[]
  phase: GamePhase
  currentPlayerId: string
  targetPlayerId: string | null
  pendingEliminationId: string | null
  selectedCardSecretId: string | null
  turnId: string
  deadline: number | null
  roundWinnerId: string | null
  seriesWinnerId: string | null
  rematchVotes: string[]
  lastMessage: string
  config: EngineConfig
}

export interface CreateGameInput {
  gameId?: string
  players: EnginePlayerInput[]
  roundsToWin: 1 | 2 | 3
  now: number
  initialVersion?: number
  config?: Partial<EngineConfig>
}

interface VersionedPlayerCommand {
  playerId: string
  expectedVersion: number
}

export interface SelectTargetCommand extends VersionedPlayerCommand {
  type: "select_target"
  turnId: string
  targetPlayerId: string
  now: number
}

export interface PickCardCommand extends VersionedPlayerCommand {
  type: "pick_card"
  turnId: string
  cardToken: string
  now: number
}

export interface RematchVoteCommand extends VersionedPlayerCommand {
  type: "rematch_vote"
  now: number
}

export interface TickCommand {
  type: "tick"
  now: number
}

export interface SetConnectionCommand {
  type: "set_connection"
  playerId: string
  connected: boolean
  reclaimControl?: boolean
  now: number
}

export interface ConvertToBotCommand {
  type: "convert_to_bot"
  playerId: string
  canReconnect: boolean
  now: number
}

export type GameCommand =
  | SelectTargetCommand
  | PickCardCommand
  | RematchVoteCommand
  | TickCommand
  | SetConnectionCommand
  | ConvertToBotCommand

export type EngineResult =
  | { ok: true; state: PrivateGameState; changed: boolean }
  | {
      ok: false
      state: PrivateGameState
      changed: false
      error: { code: ProtocolErrorCode; message: string }
    }

export interface GameProjectionContext {
  viewerPlayerId: string
  roomCode: string | null
  isPrivate: boolean
  hostPlayerId: string | null
  maxPlayers: 4 | 8
  serverTime: number
  reactions?: PublicReaction[]
}

function cloneState(state: PrivateGameState): PrivateGameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    cards: state.cards.map((card) => ({ ...card })),
    rematchVotes: [...state.rematchVotes],
    config: { ...state.config },
  }
}

function fail(state: PrivateGameState, code: ProtocolErrorCode, message: string): EngineResult {
  return { ok: false, state, changed: false, error: { code, message } }
}

function activePlayers(state: PrivateGameState): PrivatePlayerState[] {
  return state.players.filter((player) => !player.isEliminated)
}

function currentPlayer(state: PrivateGameState): PrivatePlayerState | undefined {
  return state.players.find((player) => player.id === state.currentPlayerId)
}

function nextActivePlayerId(state: PrivateGameState): string {
  const currentIndex = state.players.findIndex((player) => player.id === state.currentPlayerId)
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = state.players[(currentIndex + offset) % state.players.length]
    if (candidate && !candidate.isEliminated) return candidate.id
  }
  return state.currentPlayerId
}

function createCards(players: readonly PrivatePlayerState[], random: RandomSource): PrivateCardState[] {
  const cards = players
    .filter((player) => !player.isEliminated)
    .map((player) => ({
      secretId: random.id(),
      ownerId: player.id,
      selectionToken: random.id(),
      position: 0,
      isRevealed: false,
    }))
  return fisherYates(cards, random).map((card, position) => ({ ...card, position }))
}

/**
 * Gives every remaining card a different position and rotates every client
 * token so a revealed card cannot be tracked into the next turn.
 */
export function shuffleAndRotateCards(
  cards: readonly PrivateCardState[],
  random: RandomSource = secureRandomSource,
): PrivateCardState[] {
  const concealed = cards.map((card) => ({
    ...card,
    selectionToken: random.id(),
    isRevealed: false,
  }))
  if (concealed.length <= 1) {
    return concealed.map((card, position) => ({ ...card, position }))
  }

  const candidates = fisherYates(concealed, random)
  const arranged: PrivateCardState[] = []
  const used = new Set<string>()

  function placeCard(position: number): boolean {
    if (position === candidates.length) return true
    for (const card of candidates) {
      if (used.has(card.secretId) || card.position === position) continue
      used.add(card.secretId)
      arranged[position] = card
      if (placeCard(position + 1)) return true
      used.delete(card.secretId)
    }
    return false
  }

  if (!placeCard(0)) throw new Error("Unable to move every card to a new position")
  return arranged.map((card, position) => ({ ...card, position }))
}

function beginTurn(state: PrivateGameState, playerId: string, now: number, random: RandomSource): void {
  const player = state.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error(`Cannot begin turn for missing player ${playerId}`)

  state.currentPlayerId = playerId
  state.targetPlayerId = null
  state.pendingEliminationId = null
  state.selectedCardSecretId = null
  state.phase = "select_target"
  state.turnId = random.id()
  state.deadline = now + (player.isBot ? state.config.botThinkDurationMs : state.config.turnDurationMs)
  state.lastMessage = `${player.displayName}'s turn to choose a target.`
}

function beginStarting(state: PrivateGameState, playerId: string, now: number, random: RandomSource): void {
  const player = state.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error(`Cannot start with missing player ${playerId}`)

  state.currentPlayerId = playerId
  state.targetPlayerId = null
  state.pendingEliminationId = null
  state.selectedCardSecretId = null
  state.phase = "starting"
  state.turnId = random.id()
  state.deadline = now + state.config.startDurationMs
  state.lastMessage = "The game is about to begin."
}

function resetRound(state: PrivateGameState, now: number, random: RandomSource, incrementRound: boolean): void {
  state.players = state.players.map((player) => ({ ...player, isEliminated: false }))
  state.cards = createCards(state.players, random)
  if (incrementRound) state.currentRound += 1
  state.roundWinnerId = null
  state.seriesWinnerId = null
  state.rematchVotes = []
  const starter = state.players[random.integer(state.players.length)]
  beginTurn(state, starter.id, now, random)
}

export function createGame(
  input: CreateGameInput,
  random: RandomSource = secureRandomSource,
): PrivateGameState {
  if (input.players.length < 2) throw new Error("A game requires at least two players")
  const playerIds = new Set(input.players.map((player) => player.id))
  if (playerIds.size !== input.players.length) throw new Error("Player IDs must be unique")

  const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...input.config }
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  }

  const players: PrivatePlayerState[] = input.players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    avatarSeed: player.avatarSeed,
    isBot: player.isBot ?? false,
    canReconnect: player.canReconnect ?? !(player.isBot ?? false),
    isConnected: player.isConnected ?? !(player.isBot ?? false),
    isEliminated: false,
    seriesWins: 0,
  }))
  const starter = players[random.integer(players.length)]
  const state: PrivateGameState = {
    gameId: input.gameId ?? `game-${random.id(16)}`,
    version: input.initialVersion ?? 1,
    roundsToWin: input.roundsToWin,
    currentRound: 1,
    players,
    cards: createCards(players, random),
    phase: "starting",
    currentPlayerId: starter.id,
    targetPlayerId: null,
    pendingEliminationId: null,
    selectedCardSecretId: null,
    turnId: random.id(),
    deadline: null,
    roundWinnerId: null,
    seriesWinnerId: null,
    rematchVotes: [],
    lastMessage: "",
    config,
  }
  beginStarting(state, starter.id, input.now, random)
  return state
}

function validateVersionedCommand(state: PrivateGameState, command: VersionedPlayerCommand): EngineResult | null {
  if (command.expectedVersion !== state.version) {
    return fail(state, "CONFLICT", `State version ${state.version} is newer than ${command.expectedVersion}`)
  }
  const player = state.players.find((candidate) => candidate.id === command.playerId)
  if (!player || player.isBot || !player.canReconnect) {
    return fail(state, "UNAUTHORIZED", "This player is not controlled by the current session")
  }
  return null
}

function validateTurnDeadline(state: PrivateGameState, now: number): EngineResult | null {
  if (state.deadline === null || !Number.isFinite(state.deadline) || now >= state.deadline) {
    return fail(state, "CONFLICT", "This turn has expired")
  }
  return null
}

function executePick(state: PrivateGameState, card: PrivateCardState, actor: PrivatePlayerState, now: number): void {
  card.isRevealed = true
  state.selectedCardSecretId = card.secretId
  if (card.ownerId === actor.id) {
    state.pendingEliminationId = actor.id
    state.lastMessage = `${actor.displayName} revealed their own card and triggered the trapdoor!`
  } else if (card.ownerId === state.targetPlayerId) {
    state.pendingEliminationId = card.ownerId
    const owner = state.players.find((player) => player.id === card.ownerId)
    state.lastMessage = `${actor.displayName} found ${owner?.displayName ?? "the target"}.`
  } else {
    state.pendingEliminationId = null
    const owner = state.players.find((player) => player.id === card.ownerId)
    state.lastMessage = `${actor.displayName} revealed ${owner?.displayName ?? "another player"}'s card and missed.`
  }
  state.phase = "reveal_result"
  state.deadline = now + state.config.revealDurationMs
}

function handleSelectTarget(
  state: PrivateGameState,
  command: SelectTargetCommand,
): EngineResult {
  const invalid = validateVersionedCommand(state, command)
  if (invalid) return invalid
  if (state.phase !== "select_target") return fail(state, "INVALID_PHASE", "A target cannot be selected now")
  if (command.turnId !== state.turnId) return fail(state, "CONFLICT", "This turn has already advanced")
  if (state.currentPlayerId !== command.playerId) return fail(state, "NOT_YOUR_TURN", "It is not this player's turn")
  const expired = validateTurnDeadline(state, command.now)
  if (expired) return expired

  const target = state.players.find(
    (player) => player.id === command.targetPlayerId && !player.isEliminated && player.id !== command.playerId,
  )
  if (!target) return fail(state, "INVALID_TARGET", "Choose a different active player")

  const next = cloneState(state)
  const actor = currentPlayer(next)!
  next.targetPlayerId = target.id
  next.phase = "select_card"
  next.deadline = command.now + next.config.turnDurationMs
  next.lastMessage = `${actor.displayName} is targeting ${target.displayName}.`
  next.version += 1
  return { ok: true, state: next, changed: true }
}

function handlePickCard(state: PrivateGameState, command: PickCardCommand): EngineResult {
  const invalid = validateVersionedCommand(state, command)
  if (invalid) return invalid
  if (state.phase !== "select_card") return fail(state, "INVALID_PHASE", "A card cannot be selected now")
  if (command.turnId !== state.turnId) return fail(state, "CONFLICT", "This turn has already advanced")
  if (state.currentPlayerId !== command.playerId) return fail(state, "NOT_YOUR_TURN", "It is not this player's turn")
  const expired = validateTurnDeadline(state, command.now)
  if (expired) return expired
  if (!state.targetPlayerId) return fail(state, "INVALID_TARGET", "Select a target first")

  const next = cloneState(state)
  const card = next.cards.find((candidate) => candidate.selectionToken === command.cardToken)
  if (!card || card.isRevealed) return fail(state, "INVALID_CARD", "This card token is no longer valid")
  executePick(next, card, currentPlayer(next)!, command.now)
  next.version += 1
  return { ok: true, state: next, changed: true }
}

function autoSelectTarget(state: PrivateGameState, now: number, random: RandomSource): void {
  const actor = currentPlayer(state)!
  const candidates = activePlayers(state).filter((player) => player.id !== actor.id)
  if (candidates.length === 0) return
  const target = candidates[random.integer(candidates.length)]
  state.targetPlayerId = target.id
  state.phase = "select_card"
  state.deadline = now + (actor.isBot ? state.config.botThinkDurationMs : state.config.turnDurationMs)
  state.lastMessage = `${actor.displayName} targets ${target.displayName}.`
}

function advanceAfterReveal(state: PrivateGameState, now: number, random: RandomSource): void {
  state.cards = state.cards.map((card) => ({ ...card, isRevealed: false }))
  state.selectedCardSecretId = null

  if (state.pendingEliminationId) {
    const eliminated = state.players.find((player) => player.id === state.pendingEliminationId)
    if (eliminated) eliminated.isEliminated = true
    state.cards = shuffleAndRotateCards(
      state.cards.filter((card) => card.ownerId !== state.pendingEliminationId),
      random,
    )
    state.phase = "elimination"
    state.deadline = now + state.config.eliminationDurationMs
    state.lastMessage = `${eliminated?.displayName ?? "A player"} is eliminated.`
    return
  }

  state.cards = shuffleAndRotateCards(state.cards, random)
  state.targetPlayerId = null
  state.phase = "shuffling"
  state.deadline = now + state.config.shuffleDurationMs
  state.lastMessage = "Every card moved to a new hiding place."
}

function advanceAfterShuffle(state: PrivateGameState, now: number, random: RandomSource): void {
  beginTurn(state, nextActivePlayerId(state), now, random)
}

function advanceAfterElimination(state: PrivateGameState, now: number, random: RandomSource): void {
  const survivors = activePlayers(state)
  if (survivors.length <= 1) {
    const winner = survivors[0]
    state.pendingEliminationId = null
    state.deadline = null
    if (!winner) {
      state.phase = "series_end"
      state.seriesWinnerId = null
      state.lastMessage = "The series ended without a survivor."
      return
    }

    winner.seriesWins += 1
    state.roundWinnerId = winner.id
    if (winner.seriesWins >= state.roundsToWin) {
      state.phase = "series_end"
      state.seriesWinnerId = winner.id
      state.rematchVotes = []
      state.lastMessage = `${winner.displayName} wins the series.`
    } else {
      state.phase = "round_end"
      state.deadline = now + state.config.roundEndDurationMs
      state.lastMessage = `${winner.displayName} wins round ${state.currentRound}.`
    }
    return
  }

  state.pendingEliminationId = null
  beginTurn(state, nextActivePlayerId(state), now, random)
}

function handleTick(state: PrivateGameState, command: TickCommand, random: RandomSource): EngineResult {
  if (state.deadline === null || command.now < state.deadline || state.phase === "series_end") {
    return { ok: true, state, changed: false }
  }

  const next = cloneState(state)
  switch (next.phase) {
    case "starting":
      beginTurn(next, next.currentPlayerId, command.now, random)
      break
    case "select_target":
      autoSelectTarget(next, command.now, random)
      break
    case "select_card": {
      const cards = next.cards.filter((card) => !card.isRevealed)
      const actor = currentPlayer(next)!
      if (cards.length > 0) executePick(next, cards[random.integer(cards.length)], actor, command.now)
      break
    }
    case "reveal_result":
      advanceAfterReveal(next, command.now, random)
      break
    case "shuffling":
      advanceAfterShuffle(next, command.now, random)
      break
    case "elimination":
      advanceAfterElimination(next, command.now, random)
      break
    case "round_end":
      resetRound(next, command.now, random, true)
      break
    case "series_end":
      return { ok: true, state, changed: false }
  }
  next.version += 1
  return { ok: true, state: next, changed: true }
}

function handleRematchVote(
  state: PrivateGameState,
  command: RematchVoteCommand,
  random: RandomSource,
): EngineResult {
  const invalid = validateVersionedCommand(state, command)
  if (invalid) return invalid
  if (state.phase !== "series_end") return fail(state, "INVALID_PHASE", "Rematch voting is not open")

  const next = cloneState(state)
  if (!next.rematchVotes.includes(command.playerId)) next.rematchVotes.push(command.playerId)
  startRematchIfUnanimous(next, command.now, random)
  next.version += 1
  return { ok: true, state: next, changed: true }
}

function startRematchIfUnanimous(state: PrivateGameState, now: number, random: RandomSource): boolean {
  if (state.phase !== "series_end") return false

  const controlledHumans = state.players.filter((player) => !player.isBot && player.canReconnect)
  if (
    controlledHumans.length === 0 ||
    !controlledHumans.every((player) => state.rematchVotes.includes(player.id))
  ) {
    return false
  }

  state.players = state.players.map((player) => ({ ...player, isEliminated: false, seriesWins: 0 }))
  state.currentRound = 1
  state.cards = createCards(state.players, random)
  state.roundWinnerId = null
  state.seriesWinnerId = null
  state.rematchVotes = []
  const starter = state.players[random.integer(state.players.length)]
  beginStarting(state, starter.id, now, random)
  return true
}

function handleSetConnection(state: PrivateGameState, command: SetConnectionCommand): EngineResult {
  const existing = state.players.find((player) => player.id === command.playerId)
  if (!existing || !existing.canReconnect) return { ok: true, state, changed: false }
  const shouldReclaim = command.connected && command.reclaimControl === true
  if (existing.isConnected === command.connected && (!shouldReclaim || !existing.isBot)) {
    return { ok: true, state, changed: false }
  }

  const next = cloneState(state)
  const player = next.players.find((candidate) => candidate.id === command.playerId)!
  player.isConnected = command.connected
  if (shouldReclaim) player.isBot = false
  if (
    next.currentPlayerId === player.id &&
    (next.phase === "select_target" || next.phase === "select_card") &&
    command.connected
  ) {
    next.deadline = command.now + next.config.turnDurationMs
  }
  next.version += 1
  return { ok: true, state: next, changed: true }
}

function handleConvertToBot(
  state: PrivateGameState,
  command: ConvertToBotCommand,
  random: RandomSource,
): EngineResult {
  const existing = state.players.find((player) => player.id === command.playerId)
  if (!existing || (existing.isBot && existing.canReconnect === command.canReconnect)) {
    return { ok: true, state, changed: false }
  }
  const next = cloneState(state)
  const player = next.players.find((candidate) => candidate.id === command.playerId)!
  player.isBot = true
  player.isConnected = false
  player.canReconnect = command.canReconnect
  if (
    next.currentPlayerId === player.id &&
    (next.phase === "select_target" || next.phase === "select_card")
  ) {
    next.deadline = command.now + next.config.botThinkDurationMs
  }
  startRematchIfUnanimous(next, command.now, random)
  next.version += 1
  return { ok: true, state: next, changed: true }
}

export function applyGameCommand(
  state: PrivateGameState,
  command: GameCommand,
  random: RandomSource = secureRandomSource,
): EngineResult {
  switch (command.type) {
    case "select_target":
      return handleSelectTarget(state, command)
    case "pick_card":
      return handlePickCard(state, command)
    case "rematch_vote":
      return handleRematchVote(state, command, random)
    case "tick":
      return handleTick(state, command, random)
    case "set_connection":
      return handleSetConnection(state, command)
    case "convert_to_bot":
      return handleConvertToBot(state, command, random)
  }
}

export function projectGameState(state: PrivateGameState, context: GameProjectionContext): PublicGameSnapshot {
  const viewer = state.players.find((player) => player.id === context.viewerPlayerId)
  const canAct = Boolean(
    viewer &&
      !viewer.isBot &&
      viewer.isConnected &&
      !viewer.isEliminated &&
      state.currentPlayerId === viewer.id &&
      (state.phase === "select_target" || state.phase === "select_card"),
  )

  return {
    protocolVersion: PROTOCOL_VERSION,
    roomId: state.gameId,
    roomCode: context.roomCode,
    status: state.phase === "series_end" ? "finished" : "in_progress",
    isPrivate: context.isPrivate,
    hostPlayerId: context.hostPlayerId,
    selfPlayerId: context.viewerPlayerId,
    maxPlayers: context.maxPlayers,
    roundsToWin: state.roundsToWin,
    version: state.version,
    serverTime: context.serverTime,
    players: state.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      avatarSeed: player.avatarSeed,
      isBot: player.isBot,
      isConnected: player.isConnected,
      isEliminated: player.isEliminated,
      seriesWins: player.seriesWins,
      isHost: player.id === context.hostPlayerId,
    })),
    cards: state.cards
      .map((card) => ({
        token: card.selectionToken,
        position: card.position,
        isRevealed: card.isRevealed,
        revealedOwnerId: card.isRevealed ? card.ownerId : null,
      }))
      .sort((left, right) => left.position - right.position),
    phase: state.phase,
    currentPlayerId: state.currentPlayerId,
    targetPlayerId: state.targetPlayerId,
    pendingEliminationId: state.pendingEliminationId,
    turnId: state.turnId,
    deadline: state.deadline,
    currentRound: state.currentRound,
    roundWinnerId: state.roundWinnerId,
    seriesWinnerId: state.seriesWinnerId,
    lastMessage: state.lastMessage,
    rematchVotes: [...state.rematchVotes],
    reactions: context.reactions ?? [],
    canAct,
    canStart: false,
    canVoteRematch: Boolean(viewer && !viewer.isBot && state.phase === "series_end"),
  }
}

export function validateGameState(state: PrivateGameState): string[] {
  const errors: string[] = []
  const versionIsValid = Number.isSafeInteger(state.version) && state.version >= 0
  const currentRoundIsValid = Number.isSafeInteger(state.currentRound) && state.currentRound > 0
  const roundsToWinIsValid = state.roundsToWin === 1 || state.roundsToWin === 2 || state.roundsToWin === 3
  if (!versionIsValid) errors.push("game version must be a nonnegative safe integer")
  if (!currentRoundIsValid) errors.push("current round must be a positive safe integer")
  if (!roundsToWinIsValid) errors.push("rounds to win must be 1, 2, or 3")

  const config = state.config as Partial<EngineConfig> | null | undefined
  for (const key of [
    "startDurationMs",
    "turnDurationMs",
    "botThinkDurationMs",
    "revealDurationMs",
    "shuffleDurationMs",
    "eliminationDurationMs",
    "roundEndDurationMs",
  ] as const) {
    const value = config?.[key]
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      errors.push(`${key} must be a positive safe integer`)
    }
  }

  const playerIds = state.players.map((player) => player.id)
  if (new Set(playerIds).size !== playerIds.length) errors.push("player IDs must be unique")
  const playerById = new Map(state.players.map((player) => [player.id, player]))
  const playerWinsAreValid = state.players.every(
    (player) => Number.isSafeInteger(player.seriesWins) && player.seriesWins >= 0,
  )
  for (const player of state.players) {
    if (!Number.isSafeInteger(player.seriesWins) || player.seriesWins < 0) {
      errors.push(`player ${player.id} series wins must be a nonnegative safe integer`)
    }
  }

  const cardIds = state.cards.map((card) => card.secretId)
  const cardTokens = state.cards.map((card) => card.selectionToken)
  if (new Set(cardIds).size !== cardIds.length) errors.push("private card IDs must be unique")
  if (new Set(cardTokens).size !== cardTokens.length) errors.push("card selection tokens must be unique")

  const active = activePlayers(state)
  const activeIds = new Set(active.map((player) => player.id))
  for (const card of state.cards) {
    if (!activeIds.has(card.ownerId)) errors.push(`card ${card.secretId} belongs to an eliminated or missing player`)
  }
  for (const playerId of activeIds) {
    const ownedCards = state.cards.filter((card) => card.ownerId === playerId)
    if (ownedCards.length !== 1) errors.push(`active player ${playerId} must own exactly one card`)
  }

  const orderedPositions = state.cards.map((card) => card.position).sort((left, right) => left - right)
  if (orderedPositions.some((position, index) => position !== index)) errors.push("card positions must be contiguous")
  const current = playerById.get(state.currentPlayerId)
  if (!current) errors.push("current player is missing")
  const target = state.targetPlayerId === null ? undefined : playerById.get(state.targetPlayerId)
  if (state.targetPlayerId !== null && !target) {
    errors.push("target player is missing")
  }
  const pending = state.pendingEliminationId === null
    ? undefined
    : playerById.get(state.pendingEliminationId)
  if (state.pendingEliminationId !== null && !pending) errors.push("pending elimination player is missing")
  const selectedCard = state.selectedCardSecretId === null
    ? undefined
    : state.cards.find((card) => card.secretId === state.selectedCardSecretId)
  if (state.selectedCardSecretId !== null && !selectedCard) errors.push("selected card is missing")
  const roundWinner = state.roundWinnerId === null ? undefined : playerById.get(state.roundWinnerId)
  if (state.roundWinnerId !== null && !roundWinner) errors.push("round winner is missing")
  const seriesWinner = state.seriesWinnerId === null ? undefined : playerById.get(state.seriesWinnerId)
  if (state.seriesWinnerId !== null && !seriesWinner) errors.push("series winner is missing")

  const uniqueRematchVotes = new Set<string>()
  for (const playerId of state.rematchVotes) {
    if (uniqueRematchVotes.has(playerId)) errors.push("rematch votes must be unique")
    uniqueRematchVotes.add(playerId)
    if (!playerById.has(playerId)) errors.push(`rematch voter ${playerId} is missing`)
  }
  if (state.phase !== "series_end" && state.rematchVotes.length > 0) {
    errors.push("rematch votes are only valid during series_end")
  }

  if (state.phase === "series_end") {
    if (state.deadline !== null) errors.push("series_end must not have a deadline")
  } else if (!Number.isSafeInteger(state.deadline)) {
    errors.push("non-terminal phases require a finite safe-integer deadline")
  }

  if (
    current?.isEliminated &&
    (state.phase === "starting" ||
      state.phase === "select_target" ||
      state.phase === "select_card" ||
      state.phase === "reveal_result" ||
      state.phase === "shuffling")
  ) {
    errors.push(`${state.phase} requires an active current player`)
  }
  if (state.phase === "starting" || state.phase === "select_target" || state.phase === "shuffling") {
    if (active.length < 2) errors.push(`${state.phase} requires at least two active players`)
    if (state.targetPlayerId !== null) errors.push(`${state.phase} must not have a target player`)
    if (state.pendingEliminationId !== null) errors.push(`${state.phase} must not have a pending elimination`)
    if (state.selectedCardSecretId !== null) errors.push(`${state.phase} must not have a selected card`)
  } else {
    if (!target || target.id === state.currentPlayerId) {
      errors.push(`${state.phase} requires a different target player`)
    }
  }

  if (state.phase === "select_card" || state.phase === "reveal_result") {
    if (!target || target.isEliminated || target.id === state.currentPlayerId) {
      errors.push(`${state.phase} requires a different active target player`)
    }
  }
  if (state.phase === "select_card") {
    if (!state.cards.some((card) => !card.isRevealed)) {
      errors.push("select_card requires an unrevealed card")
    }
    if (state.pendingEliminationId !== null) errors.push("select_card must not have a pending elimination")
    if (state.selectedCardSecretId !== null) errors.push("select_card must not have a selected card")
  }

  const revealedCards = state.cards.filter((card) => card.isRevealed)
  if (state.phase === "reveal_result") {
    if (revealedCards.length !== 1) errors.push("reveal_result must expose exactly one card")
    const revealedCard = revealedCards.length === 1 ? revealedCards[0] : undefined
    if (!revealedCard || state.selectedCardSecretId !== revealedCard.secretId) {
      errors.push("reveal_result selected card must match the revealed card")
    }
    if (revealedCard) {
      const expectedPendingId =
        revealedCard.ownerId === state.currentPlayerId || revealedCard.ownerId === state.targetPlayerId
          ? revealedCard.ownerId
          : null
      if (state.pendingEliminationId !== expectedPendingId) {
        errors.push("reveal_result pending elimination must match the revealed card")
      }
    }
  } else if (state.selectedCardSecretId !== null) {
    errors.push("selected cards are only valid during reveal_result")
  }

  if (state.phase === "elimination") {
    if (!pending || !pending.isEliminated) {
      errors.push("elimination requires an eliminated pending player")
    }
    if (active.length < 1) errors.push("elimination requires at least one survivor")
  } else if (state.phase !== "reveal_result" && state.pendingEliminationId !== null) {
    errors.push("pending eliminations are only valid during reveal_result or elimination")
  }
  if (state.phase !== "reveal_result" && state.cards.some((card) => card.isRevealed)) {
    errors.push("cards may only be revealed during reveal_result")
  }

  if (state.phase !== "round_end" && state.phase !== "series_end" && state.roundWinnerId !== null) {
    errors.push("round winners are only valid during round_end or series_end")
  }
  if (state.phase !== "series_end" && state.seriesWinnerId !== null) {
    errors.push("series winners are only valid during series_end")
  }

  if (state.phase === "round_end") {
    const survivor = active.length === 1 ? active[0] : undefined
    if (!survivor) errors.push("round_end requires exactly one survivor")
    if (!survivor || state.roundWinnerId !== survivor.id) {
      errors.push("round_end winner must be the sole survivor")
    }
    if (
      survivor &&
      roundsToWinIsValid &&
      (!Number.isSafeInteger(survivor.seriesWins) || survivor.seriesWins <= 0 || survivor.seriesWins >= state.roundsToWin)
    ) {
      errors.push("round_end winner must have a non-terminal series score")
    }
  }

  if (state.phase === "series_end") {
    const survivor = active.length === 1 ? active[0] : undefined
    if (!survivor) errors.push("series_end requires exactly one survivor")
    if (!survivor || state.roundWinnerId !== survivor.id || state.seriesWinnerId !== survivor.id) {
      errors.push("series_end winner must be the sole survivor")
    }
    const scoreWinners = roundsToWinIsValid
      ? state.players.filter((player) => player.seriesWins >= state.roundsToWin)
      : []
    if (
      !survivor ||
      !roundsToWinIsValid ||
      survivor.seriesWins !== state.roundsToWin ||
      scoreWinners.length !== 1 ||
      scoreWinners[0]?.id !== survivor.id
    ) {
      errors.push("series_end requires one sole survivor with the winning score")
    }
  } else if (
    roundsToWinIsValid &&
    state.players.some((player) => player.seriesWins >= state.roundsToWin)
  ) {
    errors.push("non-terminal state cannot contain a winning series score")
  }

  if (currentRoundIsValid && playerWinsAreValid) {
    const completedRounds = state.players.reduce((total, player) => total + player.seriesWins, 0)
    const expectedCurrentRound =
      state.phase === "round_end" || state.phase === "series_end"
        ? completedRounds
        : completedRounds + 1
    if (state.currentRound !== expectedCurrentRound) {
      errors.push("current round must match the number of completed rounds")
    }
  }
  return errors
}

export function isAllowedReaction(value: string): value is AllowedReaction {
  return ["👍", "😄", "😮", "😢", "😡", "👏", "🎉", "🤔"].includes(value as AllowedReaction)
}
