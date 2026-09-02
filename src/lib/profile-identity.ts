import type { PlayerProfile } from "./game-types"

export function profileForGame(
  profile: PlayerProfile,
  serverPlayerId: string | undefined,
  solo: boolean,
): PlayerProfile {
  if (solo || !serverPlayerId) return profile
  return { ...profile, id: serverPlayerId }
}
