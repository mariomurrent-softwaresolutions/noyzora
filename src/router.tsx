import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'

/** Tiny pathname router: enough for two pages, no extra dependency. */

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}

export function usePath(): string {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname)
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function navigate(to: string) {
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

interface LinkProps {
  to: string
  className?: string
  children: ReactNode
}

export function Link({ to, className, children }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // let the browser handle new-tab clicks etc.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  )
}
