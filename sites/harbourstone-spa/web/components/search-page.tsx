import { useSearchParams } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { cms } from '@/lib/cms'
import { hrefOf, type Page, text } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { AppLink, navigate } from './app-link'
import { Eyebrow, PageTitle, Standfirst } from './section-intro'

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
    <header className="page-column pt-16 pb-6 md:pt-24">
      <Eyebrow>{text(page, 'eyebrow')}</Eyebrow>
      <PageTitle>{text(page, 'title')}</PageTitle>
      <search>
        <form className="mt-8 flex max-w-xl flex-wrap gap-3" onSubmit={search}>
          <input
            type="search"
            name="q"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="Search the site"
            className="form-field min-w-48 flex-1"
          />
          <button className="btn-ink" type="submit">
            Search
          </button>
        </form>
      </search>
      {query && results ? (
        <Standfirst>
          {results.total === 0
            ? `Nothing matches “${query}”.`
            : `${results.total} ${results.total === 1 ? 'page matches' : 'pages match'} “${query}”.`}
        </Standfirst>
      ) : !query && text(page, 'standfirst') ? (
        <Standfirst>{text(page, 'standfirst')}</Standfirst>
      ) : null}
      {results && results.items.length > 0 ? (
        <section className="mt-12">
          <ol className="max-w-2xl">
            {results.items.map((item) => (
              <li key={item.id} className="border-t border-line py-7">
                <Eyebrow>{text(item, 'eyebrow')}</Eyebrow>
                <h2 className="heading-display mt-2 text-2xl">
                  <AppLink
                    className="hover:text-brass-deep motion-safe:transition-colors"
                    href={hrefOf(item)}
                  >
                    {text(item, 'title') || item.name}
                  </AppLink>
                </h2>
                <p
                  className="mt-3 text-muted [&_mark]:bg-transparent [&_mark]:font-medium [&_mark]:text-ink"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by the CMS but for the <mark>s.
                  dangerouslySetInnerHTML={{ __html: item.excerpt }}
                />
              </li>
            ))}
          </ol>
          {pages > 1 ? (
            <nav
              className="caps flex max-w-2xl items-baseline justify-between border-t border-line pt-7 text-muted [&_a]:text-brass-deep"
              aria-label="Search results pages"
            >
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
