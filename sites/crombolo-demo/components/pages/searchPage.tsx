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
      <header class="page-header wrap">
        <h1>{model.text('title')}</h1>
        <search>
          <form class="search-form" action={model.url} method="get">
            <input
              type="search"
              name="q"
              value={query}
              aria-label={dictionary('search.placeholder')}
            />
            <button class="button" type="submit">
              {dictionary('search.button')}
            </button>
          </form>
        </search>
        {query ? (
          <p>
            {results.total === 0
              ? `${dictionary('search.none')} “${query}”.`
              : `${results.total} ${dictionary('search.found')} “${query}”.`}
          </p>
        ) : null}
      </header>
      <div class="wrap wrap--narrow">
        <ol class="search-results">
          {results.items.map((item) => (
            <li>
              <h2>
                <a href={item.url}>{item.content.text('title') || item.name}</a>
              </h2>
              <p>
                {item.excerpt.map((segment) =>
                  segment.match ? <mark>{segment.text}</mark> : segment.text,
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
