import Link from 'next/link'
import { Suspense } from 'react'
import { hrefOf, type Page, text } from '@/lib/content'
import { crombolo } from '@/lib/crombolo'
import { Eyebrow } from './section-intro'

const PER_PAGE = 10

type Query = Promise<Record<string, string | string[] | undefined>>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/** The pages matching `?q=`, best first, ten at a time: read per request, never kept. */
async function Results({ page, searchParams }: { page: Page; searchParams: Query }) {
  const query = (first((await searchParams).q) ?? '').trim()
  const at = Math.max(1, Number.parseInt(first((await searchParams).page) ?? '1', 10) || 1)
  const results = query
    ? await crombolo.fresh.search(query, { skip: (at - 1) * PER_PAGE, take: PER_PAGE })
    : { total: 0, items: [] }
  const pages = Math.ceil(results.total / PER_PAGE)
  const link = (n: number) => `${hrefOf(page)}?q=${encodeURIComponent(query)}&page=${n}`
  return (
    <>
      <search>
        <form className="search-form" action={hrefOf(page)} method="get">
          <input type="search" name="q" defaultValue={query} aria-label="Search the site" />
          <button className="button" type="submit">
            Search
          </button>
        </form>
      </search>
      {query ? (
        <p className="standfirst">
          {results.total === 0
            ? `Nothing matches “${query}”.`
            : `${results.total} ${results.total === 1 ? 'page matches' : 'pages match'} “${query}”.`}
        </p>
      ) : text(page, 'standfirst') ? (
        <p className="standfirst">{text(page, 'standfirst')}</p>
      ) : null}
      {results.items.length > 0 ? (
        <section>
          <ol className="search-results">
            {results.items.map((item) => (
              <li key={item.id}>
                <Eyebrow>{text(item, 'eyebrow')}</Eyebrow>
                <h2>
                  <Link href={hrefOf(item)}>{text(item, 'title') || item.name}</Link>
                </h2>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by the CMS but for the <mark>s. */}
                <p dangerouslySetInnerHTML={{ __html: item.excerpt }} />
              </li>
            ))}
          </ol>
          {pages > 1 ? (
            <nav className="search-pages" aria-label="Search results pages">
              {at > 1 ? <Link href={link(at - 1)}>Previous</Link> : <span />}
              <span>
                Page {at} of {pages}
              </span>
              {at < pages ? <Link href={link(at + 1)}>Next</Link> : <span />}
            </nav>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

export function SearchPage({ page, searchParams }: { page: Page; searchParams: Query }) {
  return (
    <header className="page-header">
      <Eyebrow>{text(page, 'eyebrow')}</Eyebrow>
      <h1>{text(page, 'title')}</h1>
      <Suspense fallback={null}>
        <Results page={page} searchParams={searchParams} />
      </Suspense>
    </header>
  )
}
