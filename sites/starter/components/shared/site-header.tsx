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
    <header class="border-b border-line">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4">
        <a class="text-xl font-bold text-ink" href={home.url}>
          {siteName}
        </a>
        <nav class="flex flex-wrap gap-x-5 gap-y-1" aria-label="Primary">
          {shown.map((link) => {
            const page = link.content
            const here = page
              ? page.key === home.key
                ? model.key === home.key
                : ancestry.includes(String(page.id))
              : false
            return link.url ? (
              <a
                class="text-muted hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"
                href={link.url}
                target={link.target ?? undefined}
                aria-current={here ? 'page' : undefined}
              >
                {link.label}
              </a>
            ) : (
              <span class="text-muted">{link.label}</span>
            )
          })}
        </nav>
        {searchPage ? (
          <search class="w-full sm:w-auto">
            <form action={searchPage.url} method="get">
              <input
                class="w-full rounded-md border border-line px-3 py-1.5 placeholder:text-muted focus:outline-2 focus:outline-accent sm:w-48"
                type="search"
                name="q"
                placeholder="Search"
                aria-label="Search the site"
              />
            </form>
          </search>
        ) : null}
      </div>
    </header>
  )
}
