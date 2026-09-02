import { useState, type CSSProperties } from "react"
import { getAvatar } from "../lib/avatars"

interface AvatarProps {
  avatarId?: string
  avatarUrl?: string
  name: string
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
  priority?: boolean
}

export function Avatar({ avatarId, avatarUrl, name, size = "md", className = "", priority = false }: AvatarProps) {
  const avatar = getAvatar(avatarId)
  const imageSource = avatarUrl?.startsWith("/") ? avatarUrl : avatar.imagePath
  const [failedSource, setFailedSource] = useState<string>()
  const imageFailed = failedSource === imageSource

  return (
    <span
      className={`avatar avatar--${size} ${className}`}
      style={{
        "--avatar-a": avatar.colors[0],
        "--avatar-b": avatar.colors[1],
        "--avatar-focus": avatar.focus,
        "--avatar-zoom": avatar.zoom,
      } as CSSProperties}
      aria-hidden="true"
    >
      <span className="avatar__fallback">{avatar.glyph || name.slice(0, 1).toUpperCase()}</span>
      {!imageFailed && (
        <img
          className="avatar__image"
          src={imageSource}
          alt=""
          loading={priority ? "eager" : "lazy"}
          draggable={false}
          onError={() => setFailedSource(imageSource)}
        />
      )}
    </span>
  )
}
