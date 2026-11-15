import { usePathname } from 'next/navigation'
import { AppLink } from './app-link'

/** The nav's links, the current section marked. */
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
          <AppLink
            key={link.href}
            href={link.href}
            className={here ? 'here' : undefined}
            aria-current={here ? 'page' : undefined}
          >
            {link.label}
          </AppLink>
        )
      })}
    </nav>
  )
}
