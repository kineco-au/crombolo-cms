import type { MenuItem, Navigation, PublishedContent } from '@crombolo/crombolo'

/**
 * The site name, from the config, and the primary nav: the "Main navigation" menu,
 * which editors change in the Library. Without one, the home page and its children,
 * so adding a page in the backoffice adds it here. A Search Page there is the
 * search box instead.
 */
export function SiteHeader({
  model,
  nav,
  links,
  siteName,
}: {
  model: PublishedContent
  nav: Navigation
  links: MenuItem[]
  siteName: string
}) {
  const home = nav.root()[0]
  if (!home) return null
  const ancestry = model.path.split(',')
  const children = nav.children(home, { visibleOnly: true })
  const searchPage = children.find((child) => child.contentType.alias === 'searchPage')
  const shown =
    links.length > 0
      ? links
      : [home, ...children.filter((child) => child !== searchPage)].map((page) => ({
          label: page.key === home.key ? 'Home' : page.name,
          url: page.url,
          target: null,
          content: page,
        }))
  return (
    <header class="site-header">
      <div class="container site-header__inner">
        <a class="site-name" href={home.url}>
          {siteName}
        </a>
        <nav aria-label="Primary">
          {shown.map((link) => {
            const page = link.content
            const here = page
              ? page.key === home.key
                ? model.key === home.key
                : ancestry.includes(String(page.id))
              : false
            return link.url ? (
              <a
                href={link.url}
                target={link.target ?? undefined}
                aria-current={here ? 'page' : undefined}
              >
                {link.label}
              </a>
            ) : (
              <span>{link.label}</span>
            )
          })}
        </nav>
        {searchPage ? (
          <search>
            <form class="site-search" action={searchPage.url} method="get">
              <input type="search" name="q" placeholder="Search" aria-label="Search the site" />
            </form>
          </search>
        ) : null}
      </div>
    </header>
  )
}
