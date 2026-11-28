import Link from 'next/link'
import { hrefOf, siteTree } from '@/lib/content'
import { NavLinks } from './nav-links'

/**
 * The masthead and the primary nav: the home page and its children, by name.
 * A Search Page among them is the search box at the end instead of a link.
 */
export async function SiteHeader() {
  const { home, sections } = await siteTree()
  if (!home) return null
  const searchPage = sections.find((page) => page.contentType === 'searchPage')
  const links = [
    { href: hrefOf(home), label: 'Home', exact: true },
    ...sections
      .filter((page) => page !== searchPage)
      .map((page) => ({ href: hrefOf(page), label: page.name, exact: false })),
  ]
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-md">
      <div className="page-column flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3 md:gap-x-8 md:py-4">
        <Link className="font-display text-xl tracking-wide sm:text-2xl" href={hrefOf(home)}>
          <Wordmark />
        </Link>
        <NavLinks links={links} />
        {searchPage ? (
          <search>
            <form action={hrefOf(searchPage)} method="get">
              <input
                type="search"
                name="q"
                placeholder="Search"
                aria-label="Search the site"
                className="w-28 rounded-none border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:border-brass sm:w-36 sm:focus-visible:w-52 motion-safe:transition-all"
              />
            </form>
          </search>
        ) : null}
      </div>
    </header>
  )
}

/** A mark with two colours in it: part of the design, not a value an editor reproduces. */
export function Wordmark({ plain }: { plain?: boolean }) {
  return (
    <>
      Harbour<span className={plain ? undefined : 'text-brass-deep'}>stone</span>
    </>
  )
}
