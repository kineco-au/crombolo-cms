import { type PageProps, search } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { Pager } from '../shared/pager.tsx'

const PER_PAGE = 10

/** The pages matching `?q=` in this page's language, best first. */
export default async function SearchPage(props: PageProps) {
  const { model, searchParams, dictionary } = props
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.trim() : ''
  const page = Math.max(1, Number.parseInt(String(params.page), 10) || 1)
  const results = query
    ? await search(query, { skip: (page - 1) * PER_PAGE, take: PER_PAGE })
    : { total: 0, items: [] }
  const pages = Math.ceil(results.total / PER_PAGE)
  return (
    <Layout {...props}>
      <header class={`text-column pt-12 pb-8`}>
        <h1 class="heading-display">{model.text('title')}</h1>
        <search>
          <form class="mt-4 flex max-w-lg gap-2" action={model.url} method="get">
            <input
              class="min-w-0 flex-1 rounded border border-line bg-white px-3 py-2 focus:border-green focus:ring-2 focus:ring-green/20 focus:outline-none"
              type="search"
              name="q"
              value={query}
              aria-label={dictionary('search.placeholder')}
            />
            <button class="btn-primary" type="submit">
              {dictionary('search.button')}
            </button>
          </form>
        </search>
        {query ? (
          <p class="mt-4 text-muted">
            {results.total === 0
              ? `${dictionary('search.none')} “${query}”.`
              : `${results.total} ${dictionary('search.found')} “${query}”.`}
          </p>
        ) : null}
      </header>
      <div class="text-column">
        <ol>
          {results.items.map((item) => (
            <li class="border-t border-line py-5">
              <h2 class="font-serif text-xl/snug font-bold">
                <a class="text-ink no-underline hover:text-green" href={item.url}>
                  {item.content.text('title') || item.name}
                </a>
              </h2>
              <p class="mt-1">
                {item.excerpt.map((segment) =>
                  segment.match ? (
                    <mark class="rounded-sm bg-highlight px-0.5 text-ink">{segment.text}</mark>
                  ) : (
                    segment.text
                  ),
                )}
              </p>
            </li>
          ))}
        </ol>
        <Pager
          page={page}
          pages={pages}
          href={(n) => `${model.url}?q=${encodeURIComponent(query)}&page=${n}`}
          labels={{
            newer: dictionary('blog.newer'),
            older: dictionary('blog.older'),
            position: `${dictionary('blog.page')} ${page} / ${pages}`,
          }}
        />
      </div>
    </Layout>
  )
}
