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
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-md">
      <div className="page-column flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3 md:gap-x-8 md:py-4">
        <AppLink className="font-display text-xl tracking-wide sm:text-2xl" href="/">
          <Wordmark />
        </AppLink>
        <NavLinks links={links} />
        <div className="flex items-center gap-4 md:gap-6">
          {searchPage ? (
            <search>
              <form onSubmit={search}>
                <input
                  type="search"
                  name="q"
                  placeholder="Search"
                  aria-label="Search the site"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-28 rounded-none border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:border-brass sm:w-36 sm:focus-visible:w-52 motion-safe:transition-all"
                />
              </form>
            </search>
          ) : null}
          <MemberButton />
        </div>
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
