import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { PrivacyPage, SupportPage } from "../src/screens/PublicInfoScreens"

const publicDirectory = resolve(process.cwd(), "public")

function document(title: string, description: string, markup: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#120a18" />
    <meta name="description" content="${description}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="https://cards.thoughtlesslabs.com/${title === "Privacy Policy" ? "privacy" : "support"}" />
    <link rel="icon" type="image/png" href="/assets/icons/icon-192.png" />
    <link rel="stylesheet" href="/legal.css" />
    <title>${title} · Hide &amp; Seek Cards</title>
  </head>
  <body>${markup}</body>
</html>
`
}

const pages = [
  {
    path: "privacy",
    title: "Privacy Policy",
    description: "The privacy policy for Hide & Seek Cards by Thoughtless Labs.",
    markup: renderToStaticMarkup(createElement(PrivacyPage)),
  },
  {
    path: "support",
    title: "Support",
    description: "Support and contact information for Hide & Seek Cards by Thoughtless Labs.",
    markup: renderToStaticMarkup(createElement(SupportPage)),
  },
]

for (const page of pages) {
  const outputDirectory = resolve(publicDirectory, page.path)
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(resolve(outputDirectory, "index.html"), document(page.title, page.description, page.markup))
}
