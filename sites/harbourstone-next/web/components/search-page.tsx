import Link from 'next/link'
import { Suspense } from 'react'
import { button, caps, display, field, shell } from '@/lib/classes'
import { hrefOf, type Page, text } from '@/lib/content'
import { crombolo } from '@/lib/crombolo'
import { Eyebrow, PageTitle, Standfirst } from './section-intro'

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
        <form className="mt-8 flex max-w-xl flex-wrap gap-3" action={hrefOf(page)} method="get">
          <input
            type="search"
            name="q"
            defaultValue={query}
            aria-label="Search the site"
            className={`${field} min-w-48 flex-1`}
          />
          <button className={button()} type="submit">
            Search
          </button>
        </form>
      </search>
      {query ? (
        <Standfirst>
          {results.total === 0
            ? `Nothing matches “${query}”.`
            : `${results.total} ${results.total === 1 ? 'page matches' : 'pages match'} “${query}”.`}
        </Standfirst>
      ) : text(page, 'standfirst') ? (
        <Standfirst>{text(page, 'standfirst')}</Standfirst>
      ) : null}
      {results.items.length > 0 ? (
        <section className="mt-12">
          <ol className="max-w-2xl">
            {results.items.map((item) => (
              <li key={item.id} className="border-t border-line py-7">
                <Eyebrow>{text(item, 'eyebrow')}</Eyebrow>
                <h2 className={`${display} mt-2 text-2xl`}>
                  <Link
                    className="hover:text-brass-deep motion-safe:transition-colors"
                    href={hrefOf(item)}
                  >
                    {text(item, 'title') || item.name}
                  </Link>
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
              className={`${caps} flex max-w-2xl items-baseline justify-between border-t border-line pt-7 text-muted [&_a]:text-brass-deep`}
              aria-label="Search results pages"
            >
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
    <header className={`${shell} pt-16 pb-6 md:pt-24`}>
      <Eyebrow>{text(page, 'eyebrow')}</Eyebrow>
      <PageTitle>{text(page, 'title')}</PageTitle>
      <Suspense fallback={null}>
        <Results page={page} searchParams={searchParams} />
      </Suspense>
    </header>
  )
}
