import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

import { validateNativeReleaseOrigin } from "./scripts/native-release-origin.mjs"

function nativeReleaseMetadata(): Plugin {
  const configuredOrigin = process.env.VITE_GAME_SERVER_URL?.trim()
  const serverOrigin = configuredOrigin ? validateNativeReleaseOrigin(configuredOrigin) : null
  const mode = serverOrigin ? "native-release" : "web-same-origin"
  const plistServerOrigin = serverOrigin ?? ""

  return {
    name: "native-release-metadata",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "native-release.json",
        source: `${JSON.stringify(
          {
            schemaVersion: 1,
            mode,
            serverOrigin,
          },
          null,
          2,
        )}\n`,
      })
      this.emitFile({
        type: "asset",
        fileName: "native-release.plist",
        source: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>schemaVersion</key>
  <integer>1</integer>
  <key>mode</key>
  <string>${mode}</string>
  <key>serverOrigin</key>
  <string>${plistServerOrigin}</string>
</dict>
</plist>
`,
      })
    },
  }
}

export default defineConfig({
  // Root-relative assets keep direct web invite routes such as /join/ABC234
  // working, and Capacitor serves the same paths from its local HTTPS origin.
  base: "/",
  plugins: [react(), nativeReleaseMetadata()],
  build: {
    outDir: "dist",
    sourcemap: process.env.BUILD_SOURCEMAPS === "true",
    target: "safari15.4",
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/v1": "http://127.0.0.1:8787",
      "/socket.io": {
        target: "ws://127.0.0.1:8787",
        ws: true,
      },
    },
  },
})
