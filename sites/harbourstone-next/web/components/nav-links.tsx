'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The nav's links, the current section marked: the path is the browser's, so the header stays cached. */
export function NavLinks({
  links,
}: {
  links: Array<{ href: string; label: string; exact: boolean }>
}) {
  const path = usePathname()
  return (
    <nav
      aria-label="Primary"
      className="order-last flex w-full gap-x-3 overflow-x-auto [scrollbar-width:none] justify-between md:order-none md:w-auto md:justify-start md:gap-x-7"
    >
      {links.map((link) => {
        const here = link.exact ? path === link.href : path.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            className="shrink-0 py-1 text-xs font-medium tracking-[0.12em] text-muted uppercase md:tracking-caps hover:text-brass-deep aria-[current=page]:text-brass-deep motion-safe:transition-colors"
            aria-current={here ? 'page' : undefined}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
