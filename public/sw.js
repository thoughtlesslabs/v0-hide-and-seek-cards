const CACHE = "hide-seek-shell-v3"
const OFFLINE_ART = [
  "./assets/card-back-party.webp",
  "./assets/characters-party/bramble.webp",
  "./assets/characters-party/kestrel.webp",
  "./assets/characters-party/lyra.webp",
  "./assets/characters-party/mira.webp",
  "./assets/characters-party/nia.webp",
  "./assets/characters-party/orin.webp",
  "./assets/characters-party/rowan.webp",
  "./assets/characters-party/sol.webp",
]
const SHELL = [
  "./",
  "./manifest.webmanifest",
  "./assets/icons/apple-touch-icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  ...OFFLINE_ART,
]

async function cacheScriptGraph(cache, entryScripts) {
  const queue = entryScripts.map((path) => new URL(path, self.location.href).href)
  const visited = new Set()

  while (queue.length > 0) {
    const scriptUrl = queue.shift()
    if (!scriptUrl || visited.has(scriptUrl)) continue
    visited.add(scriptUrl)

    const response = await fetch(scriptUrl, { cache: "no-store" })
    if (!response.ok) throw new Error(`Could not precache ${scriptUrl}`)
    const source = await response.clone().text()
    await cache.put(scriptUrl, response)

    for (const match of source.matchAll(/\bimport\(\s*["'`](\.?\.?\/[^"'`]+\.js)["'`]\s*\)/g)) {
      const dependency = new URL(match[1], scriptUrl)
      if (dependency.origin === self.location.origin && !visited.has(dependency.href)) {
        queue.push(dependency.href)
      }
    }
  }
}

async function installShell() {
  const cache = await caches.open(CACHE)
  const indexResponse = await fetch("./index.html", { cache: "no-store" })
  if (!indexResponse.ok) throw new Error("Could not fetch the app shell")
  const html = await indexResponse.clone().text()
  const builtAssets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith("/") || path.startsWith("./"))
  const entryScripts = builtAssets.filter((path) => path.endsWith(".js"))
  const staticAssets = builtAssets.filter((path) => !path.endsWith(".js"))

  await cache.put("./index.html", indexResponse)
  await cache.addAll([...new Set([...SHELL, ...staticAssets])])
  await cacheScriptGraph(cache, entryScripts)
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell().then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  const serverPath =
    url.pathname.startsWith("/v1/") ||
    url.pathname.startsWith("/socket.io/") ||
    url.pathname === "/healthz" ||
    url.pathname === "/readyz"
  if (event.request.method !== "GET" || url.origin !== self.location.origin || serverPath) {
    return
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request)
          if (response.ok) {
            const cache = await caches.open(CACHE)
            await cache.put("./index.html", response.clone())
          }
          return response
        } catch {
          return (await caches.match("./index.html")) ?? Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request)
      if (cached) return cached
      const response = await fetch(event.request)
      if (response.ok && response.status !== 206) {
        const cache = await caches.open(CACHE)
        await cache.put(event.request, response.clone())
      }
      return response
    })(),
  )
})
