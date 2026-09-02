import { lazy, Suspense, useEffect, useState } from "react"
import { Dices } from "lucide-react"

import { PrivacyPage, SupportPage } from "./screens/PublicInfoScreens"

const GameApp = lazy(() => import("./GameApp"))
const LayoutQaScreen = import.meta.env.DEV ? lazy(() => import("./screens/LayoutQaScreen").then((module) => ({ default: module.LayoutQaScreen }))) : undefined

function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, "")
  return path || "/"
}

export default function App() {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const updatePath = () => setPath(currentPath())
    window.addEventListener("popstate", updatePath)
    return () => window.removeEventListener("popstate", updatePath)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("main h1")
      if (!heading) return
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [path])

  if (path === "/privacy") return <PrivacyPage />
  if (path === "/support") return <SupportPage />
  if (LayoutQaScreen && path === "/__layout-qa") {
    return (
      <Suspense
        fallback={
          <main className="screen state-screen" aria-busy="true">
            <span className="loading-sigil" aria-hidden="true"><Dices /></span>
            <p role="status">Preparing layout QA…</p>
          </main>
        }
      >
        <LayoutQaScreen />
      </Suspense>
    )
  }

  return (
    <Suspense
      fallback={
        <main className="screen state-screen" aria-busy="true">
          <span className="loading-sigil" aria-hidden="true"><Dices /></span>
          <p role="status">Raising the curtain on the haunted show…</p>
        </main>
      }
    >
      <GameApp />
    </Suspense>
  )
}
