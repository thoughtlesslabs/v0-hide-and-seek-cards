import { randomUUID } from "node:crypto"
import process from "node:process"

import { io } from "socket.io-client"

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8788").replace(/\/$/, "")
const origin = process.env.SMOKE_ORIGIN || baseUrl
const timeoutMs = 12_000
const sockets = new Set()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function withTimeout(description, subscribe, timeout = timeoutMs) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => undefined
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for ${description}`))
    }, timeout)

    unsubscribe = subscribe((value) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    })
  })
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000
  let lastStatus = "no response"
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`)
      const body = await response.json()
      lastStatus = `${response.status} ${JSON.stringify(body)}`
      if (response.ok && body.ok === true && body.persistence === "durable" && body.snapshotStore === "redis") {
        return body
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Production stack did not become durably ready: ${lastStatus}`)
}

async function createSession(displayName, avatarSeed) {
  const response = await fetch(`${baseUrl}/v1/session/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify({ displayName, avatarSeed }),
  })
  if (response.status !== 201) {
    throw new Error(`Session creation returned HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

async function connectSession(session, expectedRoomId = null) {
  const socket = io(baseUrl, {
    auth: { token: session.token },
    autoConnect: false,
    extraHeaders: { Origin: origin },
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    reconnectionDelayMax: 2_000,
    randomizationFactor: 0.25,
    rejectUnauthorized: process.env.SMOKE_INSECURE_TLS !== "1",
    timeout: timeoutMs,
    transports: ["websocket"],
  })
  sockets.add(socket)

  const ready = new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      socket.off("session:ready", onReady)
      socket.off("connect_error", onError)
    }
    const onReady = (event) => {
      cleanup()
      resolve(event)
    }
    const onError = (error) => {
      cleanup()
      reject(new Error(`Socket connection failed: ${error.message}`))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for authenticated session readiness"))
    }, timeoutMs)
    socket.on("session:ready", onReady)
    socket.on("connect_error", onError)
  })

  socket.connect()
  const event = await ready
  assert(event.player.id === session.player.id, "Resumed socket identity did not match its session")
  assert(event.resumedRoomId === expectedRoomId, `Expected resumed room ${expectedRoomId}, received ${event.resumedRoomId}`)
  return socket
}

function acknowledge(socket, event, input) {
  return withTimeout(`${event} acknowledgement`, (resolve) => {
    socket.emit(event, input, resolve)
    return () => undefined
  })
}

async function successfulSnapshot(socket, event, input) {
  const ack = await acknowledge(socket, event, input)
  if (!ack.ok) throw new Error(`${event} failed: ${ack.error.code}: ${ack.error.message}`)
  return ack.data
}

function assertPublicProjection(snapshot) {
  assert(snapshot.cards.length <= snapshot.players.length, "Public card count exceeds player count")
  for (const card of snapshot.cards) {
    const keys = Object.keys(card).sort().join(",")
    assert(keys === "isRevealed,position,revealedOwnerId,token", `Unexpected public card fields: ${keys}`)
    assert(typeof card.token === "string" && card.token.length >= 16, "Card token is missing or too short")
    assert(card.revealedOwnerId === null, "A hidden card exposed its owner")
  }
  const serialized = JSON.stringify(snapshot)
  for (const forbidden of ["ownerId", "secretId", "selectionToken"]) {
    assert(!serialized.includes(`"${forbidden}"`), `Snapshot exposed hidden field ${forbidden}`)
  }
}

async function waitForSocketConnection(socket, label) {
  if (socket.connected) return
  await withTimeout(`${label} socket reconnection`, (resolve) => {
    const onConnect = () => resolve()
    socket.on("connect", onConnect)
    return () => socket.off("connect", onConnect)
  }, 30_000)
}

async function waitForRestartSignal() {
  if (!process.stdin.isTTY && process.env.SMOKE_CONTINUE_WITHOUT_PROMPT === "1") return
  await new Promise((resolve, reject) => {
    const onData = () => {
      cleanup()
      resolve()
    }
    const onEnd = () => {
      cleanup()
      reject(new Error("Standard input closed before the app restart was confirmed"))
    }
    const cleanup = () => {
      process.stdin.off("data", onData)
      process.stdin.off("end", onEnd)
      process.stdin.pause()
    }
    process.stdin.once("data", onData)
    process.stdin.once("end", onEnd)
    process.stdin.resume()
  })
}

async function main() {
  await waitUntilReady()

  const hostSession = await createSession("Smoke Lyra", "lyra")
  const guestSession = await createSession("Smoke Rowan", "rowan")
  const host = await connectSession(hostSession)
  const guest = await connectSession(guestSession)

  const created = await successfulSnapshot(host, "private:create", {
    commandId: randomUUID(),
    maxPlayers: 4,
    roundsToWin: 2,
  })
  assert(created.status === "waiting" && created.isPrivate, "Private room was not created in waiting state")
  assert(typeof created.roomCode === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(created.roomCode), "Room code is invalid")

  const joined = await successfulSnapshot(guest, "private:join", {
    commandId: randomUUID(),
    roomCode: created.roomCode,
  })
  assert(joined.roomId === created.roomId, "Guest joined a different room")

  const started = await successfulSnapshot(host, "private:start", { commandId: randomUUID() })
  assert(started.roomId === created.roomId && started.status === "in_progress", "Private game did not start")

  const hostState = await successfulSnapshot(host, "state:sync", { knownVersion: started.version })
  const guestState = await successfulSnapshot(guest, "state:sync", { knownVersion: started.version })
  assert(hostState.roomId === guestState.roomId, "Players received different rooms")
  assert(hostState.version === guestState.version, "Players received different authoritative versions")
  assert(hostState.cards.length === hostState.players.length, "A newly started round did not create one card per player")
  assertPublicProjection(hostState)
  assertPublicProjection(guestState)

  let hostRestartDisconnects = 0
  let guestRestartDisconnects = 0
  host.on("disconnect", () => {
    hostRestartDisconnects += 1
  })
  guest.on("disconnect", () => {
    guestRestartDisconnects += 1
  })
  console.log(`READY_FOR_APP_RESTART room=${created.roomId} version=${started.version}`)
  await waitForRestartSignal()
  await waitUntilReady()

  await Promise.all([
    waitForSocketConnection(host, "host"),
    waitForSocketConnection(guest, "guest"),
  ])
  assert(hostRestartDisconnects > 0, "Host socket never observed the application restart")
  assert(guestRestartDisconnects > 0, "Guest socket never observed the application restart")
  const resumedHost = await successfulSnapshot(host, "state:sync", {})
  const resumedGuest = await successfulSnapshot(guest, "state:sync", {})
  assert(resumedHost.roomId === created.roomId && resumedGuest.roomId === created.roomId, "Room did not resume after restart")
  assert(resumedHost.status === "in_progress" && resumedGuest.status === "in_progress", "Game status did not survive restart")
  assert(resumedHost.version >= started.version && resumedGuest.version >= started.version, "Authoritative version regressed after restart")
  assertPublicProjection(resumedHost)
  assertPublicProjection(resumedGuest)

  console.log(`LIVE_COMPOSE_SMOKE_OK room=${created.roomId} version=${resumedHost.version}`)
}

main()
  .catch((error) => {
    console.error(`LIVE_COMPOSE_SMOKE_FAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(() => {
    for (const socket of sockets) socket.disconnect()
  })
