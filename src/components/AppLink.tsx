import type { AnchorHTMLAttributes, MouseEvent } from "react"

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string
}

export function AppLink({ href, onClick, target, download, ...props }: AppLinkProps) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== "_self") ||
      download !== undefined
    ) {
      return
    }

    const destination = new URL(href, window.location.href)
    if (destination.origin !== window.location.origin) return
    if (
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search &&
      destination.hash
    ) {
      return
    }

    event.preventDefault()
    if (destination.href === window.location.href) return

    window.history.pushState({}, "", destination)
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }))
  }

  return <a {...props} href={href} target={target} download={download} onClick={navigate} />
}
