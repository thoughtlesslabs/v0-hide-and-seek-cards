export function roomInviteUrl(roomCode: string, origin?: string): string {
  const configuredOrigin = import.meta.env.VITE_GAME_SERVER_URL?.trim().replace(/\/$/, "")
  const publicOrigin = origin?.trim() || configuredOrigin || window.location.origin
  return new URL(`/join/${encodeURIComponent(roomCode.trim().toUpperCase())}`, publicOrigin).href
}
