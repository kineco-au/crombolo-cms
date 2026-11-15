import type { AnchorHTMLAttributes, MouseEvent } from 'react'

/**
 * Moves the app to another address without loading the page again. Next's router
 * follows `history.pushState`, so `usePathname` and Back and Forward keep up.
 */
export function navigate(href: string): void {
  history.pushState(null, '', href)
  scrollTo(0, 0)
}

/** A link to another page of the site, followed in the app; anything else as a plain link. */
export function AppLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (!href || event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (rest.target && rest.target !== '_self') return
    const url = new URL(href, location.href)
    if (url.origin !== location.origin) return
    event.preventDefault()
    navigate(`${url.pathname}${url.search}${url.hash}`)
  }
  return <a href={href} onClick={follow} {...rest} />
}
