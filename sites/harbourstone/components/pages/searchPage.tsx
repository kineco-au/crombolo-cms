import { type PageProps, search } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { Eyebrow, Standfirst } from '../shared/section-intro.tsx'

const PER_PAGE = 10

/**
 * The pages matching `?q=`, best first, ten at a time. Each result reads its
 * eyebrow and title by the aliases every page type here shares, so a whisky
 * shows as "Single malt — The Harbour 12" rather than by its node name.
 */
export default async function SearchPage({ model, nav, request }: PageProps) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const results = query
    ? await search(query, { skip: (page - 1) * PER_PAGE, take: PER_PAGE })
    : { total: 0, items: [] }
  const pages = Math.ceil(results.total / PER_PAGE)
  const link = (n: number) => `${model.url}?q=${encodeURIComponent(query)}&page=${n}`

  return (
    <Layout model={model} nav={nav}>
      <header class="page-column pt-16 pb-6 md:pt-24">
        <Eyebrow>{model.text('eyebrow')}</Eyebrow>
        <h1 class="heading-display mt-3 max-w-[20ch] text-5xl leading-none md:text-7xl">
          {model.text('title')}
        </h1>
        <search>
          <form class="mt-8 flex max-w-xl flex-wrap gap-3" action={model.url} method="get">
            <input
              class="field min-w-48 flex-1"
              type="search"
              name="q"
              value={query}
              aria-label="Search the site"
            />
            <button class="btn-ink cursor-pointer" type="submit">
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
        ) : model.hasValue('standfirst') ? (
          <Standfirst>{model.text('standfirst')}</Standfirst>
        ) : null}
      </header>

      {results.items.length > 0 ? (
        <section class="page-column">
          <ol class="mt-6 max-w-2xl">
            {results.items.map((item) => (
              <li class="border-t border-line py-7">
                <Eyebrow>{item.content.text('eyebrow')}</Eyebrow>
                <h2 class="heading-display mt-2 text-2xl leading-tight">
                  <a
                    class="no-underline hover:text-brass-deep motion-safe:transition-colors"
                    href={item.url}
                  >
                    {item.content.text('title') || item.name}
                  </a>
                </h2>
                <p class="mt-3 text-muted">
                  {item.excerpt.map((segment) =>
                    segment.match ? (
                      <mark class="bg-transparent font-medium text-ink">{segment.text}</mark>
                    ) : (
                      segment.text
                    ),
                  )}
                </p>
              </li>
            ))}
          </ol>
          {pages > 1 ? (
            <nav
              class="flex max-w-2xl items-baseline justify-between border-t border-line pt-7 text-xs font-medium tracking-caps text-muted uppercase"
              aria-label="Search results pages"
            >
              {page > 1 ? (
                <a class="text-brass-deep no-underline" href={link(page - 1)}>
                  Previous
                </a>
              ) : (
                <span />
              )}
              <span>
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <a class="text-brass-deep no-underline" href={link(page + 1)}>
                  Next
                </a>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>
      ) : null}
    </Layout>
  )
}
