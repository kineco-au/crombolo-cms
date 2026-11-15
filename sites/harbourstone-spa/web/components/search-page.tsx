import { useSearchParams } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { cms } from '@/lib/cms'
import { hrefOf, type Page, text } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { AppLink, navigate } from './app-link'
import { Eyebrow } from './section-intro'

const PER_PAGE = 10

/** The pages matching `?q=`, best first, ten at a time. */
export function SearchPage({ page }: { page: Page }) {
  const params = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const at = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const results = useLoad(`${query}|${at}`, () =>
    query
      ? cms.search(query, { skip: (at - 1) * PER_PAGE, take: PER_PAGE })
      : Promise.resolve({ total: 0, items: [] }),
  )
  const [typed, setTyped] = useState(query)
  const pages = Math.ceil((results?.total ?? 0) / PER_PAGE)
  const link = (n: number) => `${hrefOf(page)}?q=${encodeURIComponent(query)}&page=${n}`
  const search = (event: FormEvent) => {
    event.preventDefault()
    navigate(`${hrefOf(page)}?q=${encodeURIComponent(typed.trim())}`)
  }
  return (
    <header className="page-header">
      <Eyebrow>{text(page, 'eyebrow')}</Eyebrow>
      <h1>{text(page, 'title')}</h1>
      <search>
        <form className="search-form" onSubmit={search}>
          <input
            type="search"
            name="q"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="Search the site"
          />
          <button className="button" type="submit">
            Search
          </button>
        </form>
      </search>
      {query && results ? (
        <p className="standfirst">
          {results.total === 0
            ? `Nothing matches “${query}”.`
            : `${results.total} ${results.total === 1 ? 'page matches' : 'pages match'} “${query}”.`}
        </p>
      ) : !query && text(page, 'standfirst') ? (
        <p className="standfirst">{text(page, 'standfirst')}</p>
      ) : null}
      {results && results.items.length > 0 ? (
        <section>
          <ol className="search-results">
            {results.items.map((item) => (
              <li key={item.id}>
                <Eyebrow>{text(item, 'eyebrow')}</Eyebrow>
                <h2>
                  <AppLink href={hrefOf(item)}>{text(item, 'title') || item.name}</AppLink>
                </h2>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by the CMS but for the <mark>s. */}
                <p dangerouslySetInnerHTML={{ __html: item.excerpt }} />
              </li>
            ))}
          </ol>
          {pages > 1 ? (
            <nav className="search-pages" aria-label="Search results pages">
              {at > 1 ? <AppLink href={link(at - 1)}>Previous</AppLink> : <span />}
              <span>
                Page {at} of {pages}
              </span>
              {at < pages ? <AppLink href={link(at + 1)}>Next</AppLink> : <span />}
            </nav>
          ) : null}
        </section>
      ) : null}
    </header>
  )
}
