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
    <header className="masthead">
      <div className="masthead__inner">
        <Link className="wordmark" href={hrefOf(home)}>
          <Wordmark />
        </Link>
        <NavLinks links={links} />
        {searchPage ? (
          <search className="masthead__search">
            <form action={hrefOf(searchPage)} method="get">
              <input type="search" name="q" placeholder="Search" aria-label="Search the site" />
            </form>
          </search>
        ) : null}
      </div>
    </header>
  )
}

/** A mark with two colours in it: part of the design, not a value an editor reproduces. */
export function Wordmark() {
  return (
    <>
      Harbour<span>stone</span>
    </>
  )
}
