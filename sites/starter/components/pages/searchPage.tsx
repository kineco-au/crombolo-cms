import { type PageProps, search } from '@crombolo/crombolo'
import { heading, Layout } from '../shared/layout.tsx'

const PER_PAGE = 10

/** The pages matching `?q=`, best first, ten at a time, each with the text around the match. */
export default async function SearchPage(props: PageProps) {
  const { model, request } = props
  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const results = query
    ? await search(query, { skip: (page - 1) * PER_PAGE, take: PER_PAGE })
    : { total: 0, items: [] }
  const pages = Math.ceil(results.total / PER_PAGE)
  const link = (n: number) => `${model.url}?q=${encodeURIComponent(query)}&page=${n}`

  return (
    <Layout {...props}>
      <h1 class={heading}>{model.text('title') || model.name}</h1>
      <search>
        <form class="mb-6 flex max-w-xl gap-2" action={model.url} method="get">
          <input
            class="min-w-0 flex-1 rounded-md border border-line px-3 py-2 focus:outline-2 focus:outline-accent"
            type="search"
            name="q"
            value={query}
            aria-label="Search the site"
          />
          <button
            class="cursor-pointer rounded-md bg-accent px-4 py-2 font-medium text-white hover:brightness-110"
            type="submit"
          >
            Search
          </button>
        </form>
      </search>
      {query ? (
        <p class="text-muted">
          {results.total === 0
            ? `Nothing matches “${query}”.`
            : `${results.total} ${results.total === 1 ? 'page matches' : 'pages match'} “${query}”.`}
        </p>
      ) : null}
      <ol class="mt-2 divide-y divide-line">
        {results.items.map((item) => (
          <li class="py-4">
            <a class="text-lg font-semibold text-accent hover:underline" href={item.url}>
              {item.content.text('title') || item.name}
            </a>
            <p class="mt-1 text-muted [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-ink">
              {item.excerpt.map((segment) =>
                segment.match ? <mark>{segment.text}</mark> : segment.text,
              )}
            </p>
          </li>
        ))}
      </ol>
      {pages > 1 ? (
        <nav class="mt-6 flex items-center gap-6" aria-label="Search results pages">
          {page > 1 ? (
            <a class="text-accent hover:underline" href={link(page - 1)}>
              Previous
            </a>
          ) : null}
          <span class="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a class="text-accent hover:underline" href={link(page + 1)}>
              Next
            </a>
          ) : null}
        </nav>
      ) : null}
    </Layout>
  )
}
