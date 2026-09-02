import type { GameCardSnapshot, GamePhase, GamePlayerSnapshot, GameSnapshot, PlayerProfile } from "../lib/game-types"
import { GameScreen } from "./GameScreen"
import { ResultScreen } from "./ResultScreen"

const PLAYER_NAMES = [
  "Alexandria Nightshade",
  "Bartholomew Graves",
  "Cassandra Moonflower",
  "Demetrius Holloway",
  "Evangeline Blackwood",
  "Fitzwilliam Ravenscroft",
  "Guinevere Thornberry",
  "Hieronymus Dusk",
] as const

const AVATAR_IDS = ["lyra", "rowan", "mira", "bramble", "sol", "nia", "kestrel", "orin"] as const

function makePlayers(count: 4 | 8, options: { eliminatedFrom?: number; winnerIndex?: number } = {}): GamePlayerSnapshot[] {
  return PLAYER_NAMES.slice(0, count).map((displayName, index) => ({
    id: `qa-player-${index + 1}`,
    displayName,
    avatarId: AVATAR_IDS[index],
    isBot: index > 0,
    isEliminated: options.eliminatedFrom === undefined ? false : index >= options.eliminatedFrom,
    roundWins: index === options.winnerIndex ? 2 : index % 3 === 0 ? 1 : 0,
  }))
}

function makeCards(count: number, revealedOwnerId?: string): GameCardSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `qa-card-${index + 1}`,
    position: index,
    isRevealed: index === 0 && Boolean(revealedOwnerId),
    revealedOwnerId: index === 0 ? revealedOwnerId : undefined,
  }))
}

function makeProfile(players: GamePlayerSnapshot[]): PlayerProfile {
  return {
    id: players[0].id,
    displayName: players[0].displayName,
    avatarId: "lyra",
  }
}

function makeGame(playerCount: 4 | 8, phase: GamePhase): GameSnapshot {
  const players = makePlayers(playerCount)
  const targetPlayer = players[1]
  const revealedOwner = phase === "revealing" || phase === "eliminating" ? players.at(-1) : undefined

  return {
    id: `layout-qa-${playerCount}-${phase}`,
    lobbyId: "layout-qa-lobby",
    version: 42,
    phase,
    players,
    cards: makeCards(playerCount, revealedOwner?.id),
    currentPlayerId: players[0].id,
    targetPlayerId: phase === "select_card" || phase === "revealing" || phase === "eliminating" ? targetPlayer.id : undefined,
    round: 2,
    roundsToWin: 3,
    turnDeadlineAt: Date.now() + 25_000,
    turnDurationMs: 30_000,
    pendingEliminationId: revealedOwner?.id,
    canAct: true,
    reactions: players.slice(0, Math.min(players.length, 4)).map((player, index) => ({
      playerId: player.id,
      emoji: ["👍", "😄", "😮", "👏"][index],
      expiresAt: Date.now() + 60_000,
    })),
    message: revealedOwner
      ? `${revealedOwner.displayName} was found and dropped from the table.`
      : "Choose carefully before the deck moves again.",
    lastEvent: revealedOwner
      ? {
          id: "layout-qa-elimination",
          kind: "found",
          message: `${revealedOwner.displayName} was hiding here!`,
          actorId: players[0].id,
          targetId: targetPlayer.id,
          ownerId: revealedOwner.id,
        }
      : undefined,
  }
}

function makeResultGame(): GameSnapshot {
  const players = makePlayers(8, { eliminatedFrom: 0, winnerIndex: 7 }).map((player, index) => ({
    ...player,
    isEliminated: index !== 7,
  }))

  return {
    id: "layout-qa-result",
    lobbyId: "layout-qa-lobby",
    version: 99,
    phase: "series_end",
    players,
    cards: [],
    currentPlayerId: players[7].id,
    round: 4,
    roundsToWin: 3,
    winnerId: players[7].id,
    rematchVotes: [players[0].id],
    message: `${players[7].displayName} survives the show.`,
  }
}

export function LayoutQaScreen() {
  const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "game-8-select-card"
  const noop = () => undefined
  const accept = async () => true

  if (scenario === "result-8") {
    const game = makeResultGame()
    return (
      <ResultScreen
        profile={makeProfile(game.players)}
        game={game}
        connection="connected"
        rematchPending={false}
        onRematch={noop}
        onHome={noop}
        onRetry={noop}
        onDismissError={noop}
      />
    )
  }

  const playerCount = scenario.includes("-4-") ? 4 : 8
  const phase = scenario.endsWith("select-target")
    ? "select_target"
    : scenario.endsWith("revealing")
      ? "revealing"
      : scenario.endsWith("eliminating")
        ? "eliminating"
        : "select_card"
  const game = makeGame(playerCount, phase)

  return (
    <GameScreen
      profile={makeProfile(game.players)}
      game={game}
      connection="connected"
      onSelectTarget={accept}
      onPickCard={accept}
      onReaction={noop}
      onRetry={noop}
      onDismissError={noop}
      onLeave={noop}
    />
  )
}
