import { Clipboard } from "@capacitor/clipboard"
import { Capacitor } from "@capacitor/core"
import { Share } from "@capacitor/share"

export async function copyText(value: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Clipboard.write({ string: value })
    return
  }
  await navigator.clipboard.writeText(value)
}

export function canShareText(): boolean {
  return Capacitor.isNativePlatform() || Reflect.has(navigator, "share")
}

export async function shareText(title: string, text: string): Promise<"shared" | "cancelled" | "unavailable"> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text, dialogTitle: title })
      return "shared"
    }
    if (typeof navigator.share === "function") {
      await navigator.share({ title, text })
      return "shared"
    }
    return "unavailable"
  } catch {
    return "cancelled"
  }
}
