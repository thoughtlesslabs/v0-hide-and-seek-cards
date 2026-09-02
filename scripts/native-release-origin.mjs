import { isIP } from "node:net"

const RESERVED_SUFFIXES = [
  ".example",
  ".example.com",
  ".example.net",
  ".example.org",
  ".home.arpa",
  ".invalid",
  ".internal",
  ".lan",
  ".local",
  ".localhost",
  ".test",
]

export function validateNativeReleaseOrigin(input) {
  const value = input?.trim()
  if (!value) throw new Error("VITE_GAME_SERVER_URL is required")

  let serverUrl
  try {
    serverUrl = new URL(value)
  } catch {
    throw new Error("VITE_GAME_SERVER_URL must be a valid absolute URL")
  }

  const hostname = serverUrl.hostname.toLowerCase()
  const isPlaceholder =
    hostname.endsWith(".") ||
    isIP(hostname.replace(/^\[|\]$/g, "")) !== 0 ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname === "example.com" ||
    hostname === "example.net" ||
    hostname === "example.org" ||
    hostname === "home.arpa" ||
    RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))

  if (serverUrl.protocol !== "https:" || isPlaceholder) {
    throw new Error("VITE_GAME_SERVER_URL must use HTTPS on the real public game domain")
  }
  if (serverUrl.username || serverUrl.password || serverUrl.search || serverUrl.hash) {
    throw new Error("VITE_GAME_SERVER_URL must not contain credentials, a query string, or a fragment")
  }
  if (serverUrl.pathname !== "/" || serverUrl.port) {
    throw new Error("VITE_GAME_SERVER_URL must be an HTTPS origin on the default port with no path")
  }

  return serverUrl.origin
}
