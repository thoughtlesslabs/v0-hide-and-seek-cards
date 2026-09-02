import { access, mkdir, readdir, rm, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const playDir = resolve(root, "store-assets/google-play")
const appStoreDir = resolve(root, "store-assets/app-store")
const sourceCaptureDir = resolve(root, "store-assets/source-captures/android")
const iphoneSourceCaptureDir = resolve(root, "store-assets/source-captures/iphone")

const captures = {
  profile: process.env.STORE_CAPTURE_PROFILE || resolve(sourceCaptureDir, "profile.png"),
  game: process.env.STORE_CAPTURE_GAME || resolve(sourceCaptureDir, "game.png"),
  result: process.env.STORE_CAPTURE_RESULT || resolve(sourceCaptureDir, "result.png"),
}

const iphoneCaptures = {
  profile: process.env.STORE_CAPTURE_IPHONE_PROFILE || resolve(iphoneSourceCaptureDir, "profile.png"),
  game: process.env.STORE_CAPTURE_IPHONE_GAME || resolve(iphoneSourceCaptureDir, "game.png"),
  result: process.env.STORE_CAPTURE_IPHONE_RESULT || resolve(iphoneSourceCaptureDir, "result.png"),
}

const screenshotPlans = [
  { key: "game", name: "01-solo-game", top: 96 },
  { key: "result", name: "02-round-results", top: 300 },
  { key: "profile", name: "03-choose-a-contestant", top: 250 },
]

async function requireCapture(path, width, height, label) {
  try {
    await access(path)
  } catch {
    throw new Error(`${label} capture not found at ${path}`)
  }
  const metadata = await sharp(path).metadata()
  if (metadata.width !== width || metadata.height !== height) {
    throw new Error(`${label} capture must be ${width}x${height}; received ${metadata.width}x${metadata.height}`)
  }
}

await Promise.all(
  screenshotPlans.map((plan) => requireCapture(captures[plan.key], 1440, 3120, `Android ${plan.key}`)),
)

await Promise.all(
  screenshotPlans.map((plan) =>
    requireCapture(iphoneCaptures[plan.key], 1284, 2778, `iPhone ${plan.key}`),
  ),
)

await Promise.all([mkdir(playDir, { recursive: true }), mkdir(appStoreDir, { recursive: true })])
const existingPlayFiles = await readdir(playDir)
await Promise.all(
  existingPlayFiles
    .filter((name) => /^\d{2}-.*-1080x1920\.png$/.test(name))
    .map((name) => rm(resolve(playDir, name), { force: true })),
)

const portraitPaths = ["lyra", "rowan", "mira", "orin"].map((name) =>
  resolve(root, `public/assets/characters-party/${name}.webp`),
)

function circleMask(size) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  )
}

async function portraitBadge(path, size, stroke) {
  const portrait = await sharp(path)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: circleMask(size), blend: "dest-in" }])
    .png()
    .toBuffer()
  const canvas = size + 14
  const ring = Buffer.from(
    `<svg width="${canvas}" height="${canvas}" xmlns="http://www.w3.org/2000/svg"><circle cx="${canvas / 2}" cy="${canvas / 2}" r="${size / 2 + 4}" fill="none" stroke="${stroke}" stroke-width="6"/><circle cx="${canvas / 2}" cy="${canvas / 2}" r="${size / 2 + 8}" fill="none" stroke="#f5d59c" stroke-opacity=".34" stroke-width="2"/></svg>`,
  )
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: portrait, left: 7, top: 7 }, { input: ring, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

const featureBase = Buffer.from(`
  <svg width="1024" height="500" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="67%" cy="43%" r="82%">
        <stop offset="0" stop-color="#63348c"/>
        <stop offset=".5" stop-color="#2c1338"/>
        <stop offset="1" stop-color="#120a18"/>
      </radialGradient>
      <linearGradient id="acid" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#f4ff9a"/><stop offset=".55" stop-color="#c7f243"/><stop offset="1" stop-color="#84b92c"/>
      </linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="1024" height="500" fill="url(#bg)"/>
    <circle cx="760" cy="250" r="210" fill="#ff4f6d" opacity=".1"/>
    <circle cx="760" cy="250" r="166" fill="none" stroke="#c7f243" stroke-opacity=".24" stroke-width="3"/>
    <circle cx="760" cy="250" r="228" fill="none" stroke="#ff4f6d" stroke-opacity=".24" stroke-width="3"/>
    <path d="M505 28l13 26 29 4-21 20 5 29-26-14-26 14 5-29-21-20 29-4z" fill="#c7f243" opacity=".9"/>
    <path d="M954 326l9 18 20 3-15 14 4 20-18-10-18 10 4-20-15-14 20-3z" fill="#ff4f6d" opacity=".9"/>
    <g fill="#f5d59c">
      <circle cx="71" cy="77" r="3"/><circle cx="476" cy="63" r="2"/><circle cx="554" cy="402" r="4"/>
      <circle cx="954" cy="83" r="3"/><circle cx="932" cy="424" r="2"/><circle cx="397" cy="444" r="2"/>
    </g>
    <g fill="#42d6c4" opacity=".82"><circle cx="520" cy="120" r="3"/><circle cx="982" cy="286" r="4"/><circle cx="84" cy="414" r="2"/></g>
    <rect x="58" y="66" width="430" height="368" rx="30" fill="#120a18" fill-opacity=".68" stroke="#ff4f6d" stroke-opacity=".5" stroke-width="2"/>
    <text x="273" y="145" text-anchor="middle" fill="#c7f243" font-family="Avenir Next,Arial,sans-serif" font-size="18" font-weight="900" letter-spacing="5">A PARTY GAME TO DIE FOR</text>
    <text x="273" y="224" text-anchor="middle" fill="#fff8e8" font-family="Arial Black,Impact,sans-serif" font-size="54" font-weight="900" letter-spacing="1">HIDE &amp; SEEK</text>
    <text x="273" y="286" text-anchor="middle" fill="url(#acid)" font-family="Arial Black,Impact,sans-serif" font-size="39" font-weight="900" letter-spacing="12">CARDS</text>
    <line x1="156" y1="319" x2="390" y2="319" stroke="#ff4f6d" stroke-opacity=".72" stroke-width="2"/>
    <text x="273" y="362" text-anchor="middle" fill="#f5d59c" font-family="Avenir Next,Arial,sans-serif" font-size="22">Pick. Flip. Try not to die.</text>
    <text x="273" y="400" text-anchor="middle" fill="#42d6c4" font-family="Avenir Next,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="3">SOLO  •  FRIENDS  •  ONLINE</text>
    <ellipse cx="715" cy="442" rx="175" ry="24" fill="#000" opacity=".38" filter="url(#glow)"/>
  </svg>
`)

const card = await sharp(resolve(root, "public/assets/card-back-party.webp"))
  .resize(180, 288, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .rotate(-7, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()
const badges = await Promise.all([
  portraitBadge(portraitPaths[0], 104, "#ff4f6d"),
  portraitBadge(portraitPaths[1], 104, "#42d6c4"),
  portraitBadge(portraitPaths[2], 104, "#c7f243"),
  portraitBadge(portraitPaths[3], 104, "#e23a88"),
])

await sharp(featureBase)
  .composite([
    { input: card, left: 635, top: 109 },
    { input: badges[0], left: 568, top: 44 },
    { input: badges[1], left: 824, top: 69 },
    { input: badges[2], left: 850, top: 303 },
    { input: badges[3], left: 571, top: 339 },
  ])
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(resolve(playDir, "feature-graphic-1024x500.png"))

await sharp(resolve(root, "assets/icon-only.png"))
  .resize(512, 512, { fit: "cover" })
  .ensureAlpha(1)
  .png({ compressionLevel: 9 })
  .toFile(resolve(playDir, "icon-512.png"))

await sharp(resolve(root, "assets/icon-only.png"))
  .resize(1024, 1024, { fit: "cover" })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(resolve(appStoreDir, "icon-1024.png"))

for (const plan of screenshotPlans) {
  const input = captures[plan.key]
  await sharp(input)
    .extract({ left: 0, top: plan.top, width: 1440, height: 2560 })
    .resize(1080, 1920, { fit: "fill" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(resolve(playDir, `${plan.name}-1080x1920.png`))
}

const iphoneOutputNames = screenshotPlans.map((plan) =>
  resolve(appStoreDir, `${plan.name}-1284x2778.png`),
)
await Promise.all(
  screenshotPlans.map((plan, index) =>
    sharp(iphoneCaptures[plan.key])
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(iphoneOutputNames[index]),
  ),
)

async function validateOutput(path, expected) {
  const [metadata, file] = await Promise.all([sharp(path).metadata(), stat(path)])
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    throw new Error(`${path} has unexpected dimensions ${metadata.width}x${metadata.height}`)
  }
  if (metadata.hasAlpha !== expected.hasAlpha) {
    throw new Error(`${path} alpha channel does not match the store requirement`)
  }
  if (file.size > expected.maxBytes) {
    throw new Error(`${path} is ${file.size} bytes; maximum is ${expected.maxBytes}`)
  }
}

await Promise.all([
  validateOutput(resolve(playDir, "feature-graphic-1024x500.png"), {
    width: 1024,
    height: 500,
    hasAlpha: false,
    maxBytes: 15 * 1024 * 1024,
  }),
  validateOutput(resolve(playDir, "icon-512.png"), {
    width: 512,
    height: 512,
    hasAlpha: true,
    maxBytes: 1024 * 1024,
  }),
  validateOutput(resolve(appStoreDir, "icon-1024.png"), {
    width: 1024,
    height: 1024,
    hasAlpha: false,
    maxBytes: 10 * 1024 * 1024,
  }),
  ...screenshotPlans.map((plan) =>
    validateOutput(resolve(playDir, `${plan.name}-1080x1920.png`), {
      width: 1080,
      height: 1920,
      hasAlpha: false,
      maxBytes: 8 * 1024 * 1024,
    }),
  ),
  ...iphoneOutputNames.map((path) =>
    validateOutput(path, {
      width: 1284,
      height: 2778,
      hasAlpha: false,
      maxBytes: 10 * 1024 * 1024,
    }),
  ),
])

console.log(`Store assets written to ${resolve(root, "store-assets")}`)
