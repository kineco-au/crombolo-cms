import type { Navigation, PublishedContent } from '@crombolo/crombolo'
import { shell } from './classes.ts'

/**
 * The masthead and the primary nav.
 *
 * The nav is the home page followed by its children, labelled with each node's
 * name rather than its title — the About page's title is a sentence, and a nav
 * wants a word. Adding a page in the backoffice adds it here; there is no list
 * of links to keep in step.
 *
 * There is no hamburger because there is no client-side JavaScript on this
 * site: below the breakpoint the links wrap under the wordmark instead, which
 * flex-wrap does alone.
 *
 * A Search Page among the children is the search box at the end instead of a
 * link: a plain GET form, which needs no script either.
 */
export function SiteHeader({ model, nav }: { model: PublishedContent; nav: Navigation }) {
  const home = nav.root()[0]
  if (!home) return null
  const ancestry = model.path.split(',')
  const children = nav.children(home)
  const searchPage = children.find((child) => child.contentType.alias === 'searchPage')
  const links = [home, ...children.filter((child) => child !== searchPage)]
  return (
    <header class="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-md">
      <div class={`${shell} flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-4`}>
        <a class="font-display text-2xl tracking-wide no-underline" href={home.url}>
          <Wordmark />
        </a>
        <nav aria-label="Primary" class="flex flex-wrap gap-x-7 gap-y-2">
          {links.map((link) => {
            const here =
              link.key === home.key ? model.key === home.key : ancestry.includes(String(link.id))
            return (
              <a
                href={link.url}
                class="text-xs font-medium tracking-caps text-muted uppercase no-underline hover:text-brass-deep aria-[current=page]:text-brass-deep motion-safe:transition-colors"
                aria-current={here ? 'page' : undefined}
              >
                {link.key === home.key ? 'Home' : link.name}
              </a>
            )
          })}
        </nav>
        {searchPage ? (
          <search>
            <form action={searchPage.url} method="get">
              <input
                type="search"
                name="q"
                placeholder="Search"
                aria-label="Search the site"
                class="w-36 border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:w-52 focus-visible:border-brass motion-safe:transition-all"
              />
            </form>
          </search>
        ) : null}
      </div>
    </header>
  )
}

/**
 * Written out rather than read from the home page's title: a wordmark is a mark
 * with two colours in it, which makes it part of the design and not a value an
 * editor should have to reproduce. The page title stays the editable one.
 */
export function Wordmark({ plain }: { plain?: boolean }) {
  return (
    <>
      Harbour<span class={plain ? undefined : 'text-brass-deep'}>stone</span>
    </>
  )
}
