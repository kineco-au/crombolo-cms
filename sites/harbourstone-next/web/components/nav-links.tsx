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
    <nav aria-label="Primary">
      {links.map((link) => {
        const here = link.exact ? path === link.href : path.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={here ? 'here' : undefined}
            aria-current={here ? 'page' : undefined}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
