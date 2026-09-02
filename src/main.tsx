import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react"
import { Capacitor } from "@capacitor/core"
import { SplashScreen } from "@capacitor/splash-screen"
import { StatusBar, Style } from "@capacitor/status-bar"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./styles.css"

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Hide & Seek Cards client error", error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="screen state-screen state-screen--card">
          <h1>The cards got mixed up</h1>
          <p>Reload the game to put everything back in place.</p>
          <button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload game</button>
        </main>
      )
    }
    return this.props.children
  }
}

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root application mount")

const isNative = Capacitor.isNativePlatform()
document.documentElement.dataset.platform = isNative ? "native" : "web"

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

if (isNative) {
  void Promise.all([
    StatusBar.setStyle({ style: Style.Dark }),
    StatusBar.setBackgroundColor({ color: "#120d24" }),
    SplashScreen.hide({ fadeOutDuration: 280 }),
  ]).catch(() => undefined)
}

if (import.meta.env.PROD && !isNative && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  })
}
