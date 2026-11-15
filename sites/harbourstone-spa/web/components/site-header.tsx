import { type FormEvent, useState } from 'react'
import { cms } from '@/lib/cms'
import { childrenOf, hrefOf } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { AppLink, navigate } from './app-link'
import { MemberButton, useMember } from './member'
import { NavLinks } from './nav-links'

/** Pages that are not sections: the search box, the footer's settings and where members sign in. */
const NOT_SECTIONS = new Set(['searchPage', 'siteSettings', 'loginPage'])

/** The home page and the pages below it, read again once a member signs in or out. */
async function siteTree() {
  const found = await cms.route('/')
  const home = found.kind === 'page' ? found.item : undefined
  return { home, sections: home ? await childrenOf(home) : [] }
}

/**
 * The masthead and the primary nav: the home page and its children, by name. A
 * Search Page among them is the search box at the end instead of a link, and the
 * members' page is listed only to a member who may open it.
 */
export function SiteHeader() {
  const { signedIn } = useMember()
  const tree = useLoad(`nav|${signedIn}`, siteTree)
  const [query, setQuery] = useState('')
  const home = tree?.home
  const searchPage = tree?.sections.find((page) => page.contentType === 'searchPage')
  const links = home
    ? [
        { href: hrefOf(home), label: 'Home', exact: true },
        ...(tree?.sections ?? [])
          .filter((page) => !NOT_SECTIONS.has(page.contentType))
          .map((page) => ({ href: hrefOf(page), label: page.name, exact: false })),
      ]
    : []
  const search = (event: FormEvent) => {
    event.preventDefault()
    if (searchPage) navigate(`${hrefOf(searchPage)}?q=${encodeURIComponent(query.trim())}`)
  }
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <AppLink className="wordmark" href="/">
          <Wordmark />
        </AppLink>
        <NavLinks links={links} />
        {searchPage ? (
          <search className="masthead__search">
            <form onSubmit={search}>
              <input
                type="search"
                name="q"
                placeholder="Search"
                aria-label="Search the site"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
          </search>
        ) : null}
        <MemberButton />
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
