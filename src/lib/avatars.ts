import type { AvatarId } from "./game-types"

export interface AvatarOption {
  id: AvatarId
  name: string
  imagePath: string
  colors: [string, string]
  glyph: string
  focus: string
  zoom: number
}

export const AVATARS: readonly AvatarOption[] = [
  { id: "lyra", name: "Lyra", imagePath: "/assets/characters-party/lyra.webp", colors: ["#9167d7", "#483071"], glyph: "L", focus: "48% 31%", zoom: 1.34 },
  { id: "rowan", name: "Rowan", imagePath: "/assets/characters-party/rowan.webp", colors: ["#55a9c5", "#295b77"], glyph: "R", focus: "49% 32%", zoom: 1.36 },
  { id: "mira", name: "Mira", imagePath: "/assets/characters-party/mira.webp", colors: ["#74a66a", "#365f45"], glyph: "M", focus: "52% 32%", zoom: 1.34 },
  { id: "bramble", name: "Bramble", imagePath: "/assets/characters-party/bramble.webp", colors: ["#8f9ed8", "#4b568a"], glyph: "B", focus: "47% 33%", zoom: 1.36 },
  { id: "sol", name: "Sol", imagePath: "/assets/characters-party/sol.webp", colors: ["#da7957", "#7c3d43"], glyph: "S", focus: "51% 32%", zoom: 1.35 },
  { id: "nia", name: "Nia", imagePath: "/assets/characters-party/nia.webp", colors: ["#4dafac", "#2a6b74"], glyph: "N", focus: "49% 31%", zoom: 1.38 },
  { id: "kestrel", name: "Kestrel", imagePath: "/assets/characters-party/kestrel.webp", colors: ["#e2a94b", "#8c572c"], glyph: "K", focus: "52% 31%", zoom: 1.34 },
  { id: "orin", name: "Orin", imagePath: "/assets/characters-party/orin.webp", colors: ["#b07bc5", "#664474"], glyph: "O", focus: "49% 34%", zoom: 1.35 },
] as const

export function getAvatar(avatarId: string | undefined): AvatarOption {
  return AVATARS.find((avatar) => avatar.id === avatarId) ?? AVATARS[0]
}
