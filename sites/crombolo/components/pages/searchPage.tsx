import { type PageProps, search } from '@crombolo/crombolo'
import { DocsLayout } from '../shared/docs.tsx'
import { LINK, SEARCH_BUTTON, SEARCH_FORM, SEARCH_INPUT } from '../shared/styles.tsx'

const PER_PAGE = 10

/** The docs pages matching `?q=`, best first, ten at a time, each with the text around the match. */
export default async function SearchPage(props: PageProps) {
  const { model, request } = props
  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const results = query
    ? await search(query, {
        types: ['docsPage', 'docsSection'],
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
      })
    : { total: 0, items: [] }
  const pages = Math.ceil(results.total / PER_PAGE)
  const link = (n: number) => `${model.url}?q=${encodeURIComponent(query)}&page=${n}`

  return (
    <DocsLayout {...props}>
      <search>
        <form class={SEARCH_FORM} action={model.url} method="get">
          <input
            class={SEARCH_INPUT}
            type="search"
            name="q"
            value={query}
            aria-label="Search the docs"
          />
          <button class={SEARCH_BUTTON} type="submit">
            Search
          </button>
        </form>
      </search>
      {query ? (
        <p class="mb-6 text-muted" role="status">
          {results.total === 0
            ? `Nothing matches “${query}”.`
            : `${results.total} ${results.total === 1 ? 'page matches' : 'pages match'} “${query}”.`}
        </p>
      ) : null}
      <ol class="space-y-6">
        {results.items.map((item) => (
          <li>
            <a class={`${LINK} text-lg font-semibold`} href={item.url}>
              {item.content.text('title') || item.name}
            </a>
            <p class="mt-1 text-muted">
              {item.excerpt.map((segment) =>
                segment.match ? (
                  <mark class="rounded-sm bg-arc px-0.5 text-ink">{segment.text}</mark>
                ) : (
                  segment.text
                ),
              )}
            </p>
          </li>
        ))}
      </ol>
      {pages > 1 ? (
        <nav class="mt-10 flex items-center gap-6" aria-label="Search results pages">
          {page > 1 ? (
            <a class={`${LINK} font-semibold`} href={link(page - 1)}>
              Previous
            </a>
          ) : null}
          <span class="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a class={`${LINK} font-semibold`} href={link(page + 1)}>
              Next
            </a>
          ) : null}
        </nav>
      ) : null}
    </DocsLayout>
  )
}
