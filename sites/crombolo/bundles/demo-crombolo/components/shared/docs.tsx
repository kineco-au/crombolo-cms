import type { Child, Navigation, PageProps, PublishedContent } from '@crombolo/crombolo'
import { Layout } from './layout.tsx'

const DOCS_PAGE = 'docsPage'

/** The section a docs page sits in: the page itself when it is the section. */
export function docsSectionOf(model: PublishedContent, nav: Navigation) {
  if (model.contentType.alias === 'docsSection') return model
  return nav.ancestors(model).find((page) => page.contentType.alias === 'docsSection')
}

const pagesUnder = (page: PublishedContent, nav: Navigation) =>
  nav.children(page, { visibleOnly: true }).filter((child) => child.contentType.alias === DOCS_PAGE)

/** Every docs page in reading order: each page, then the pages under it. */
export function readingOrder(section: PublishedContent, nav: Navigation): PublishedContent[] {
  const walk = (page: PublishedContent): PublishedContent[] =>
    pagesUnder(page, nav).flatMap((child) => [child, ...walk(child)])
  return [section, ...walk(section)]
}

export interface Heading {
  id: string
  text: string
}

const decode = (text: string) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

/** The second-level headings of a page's body that carry an id, for "On this page". */
export function headingsOf(markup: string): Heading[] {
  return [...markup.matchAll(/<h2\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)].map((match) => ({
    id: decode(match[1] ?? ''),
    text: decode((match[2] ?? '').replaceAll(/<[^>]+>/g, '')).trim(),
  }))
}

const NAV_LINK =
  'block rounded-md px-2 py-1.5 text-terracotta-text hover:bg-arc aria-[current=page]:bg-arc aria-[current=page]:font-semibold aria-[current=page]:text-ink'

function Tree({
  page,
  nav,
  model,
  open,
  nested,
}: {
  page: PublishedContent
  nav: Navigation
  model: PublishedContent
  open: Set<string>
  nested?: boolean
}) {
  const children = pagesUnder(page, nav)
  if (children.length === 0) return null
  return (
    <ul class={nested ? 'ml-2 border-l border-line pl-3' : undefined}>
      {children.map((child) => (
        <li>
          <a
            class={NAV_LINK}
            href={child.url}
            aria-current={child.key === model.key ? 'page' : undefined}
          >
            {child.name}
          </a>
          {open.has(child.key) ? (
            <Tree page={child} nav={nav} model={model} open={open} nested />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

const PAGER_LINK =
  'block rounded-lg border border-line bg-white px-4 py-3 font-semibold text-terracotta-text transition-colors hover:border-terracotta motion-reduce:transition-none'

/** The frame every docs page shares: the section's contents beside the page. */
export function DocsLayout(props: PageProps & { children?: Child; headings?: Heading[] }) {
  const { model, nav, children } = props
  const section = docsSectionOf(model, nav)
  if (!section) return <Layout {...props}>{children}</Layout>
  // The pages on the way down to this one are opened; the rest stay closed, so
  // the contents stay short on a phone.
  const open = new Set([model.key, ...nav.ancestors(model).map((page) => page.key)])
  const search = nav.children(section).find((child) => child.contentType.alias === 'searchPage')
  const order = readingOrder(section, nav)
  const at = order.findIndex((page) => page.key === model.key)
  const previous = at > 0 ? order[at - 1] : undefined
  const next = at >= 0 ? order[at + 1] : undefined
  const trail = nav
    .ancestors(model)
    .reverse()
    .filter((page) => page.contentType.alias === DOCS_PAGE || page.key === section.key)
  const headings = props.headings ?? []

  return (
    <Layout {...props}>
      <div class="page-column grid gap-8 pt-8 pb-14 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-14 md:pt-12 md:pb-20">
        <aside class="border-b border-line pb-6 text-[0.9375rem] md:border-0 md:pb-0">
          {search ? (
            <search>
              <form class="search-form" action={search.url} method="get">
                <input
                  class="search-input"
                  type="search"
                  name="q"
                  aria-label="Search the docs"
                  placeholder="Search"
                />
                <button class="search-button" type="submit">
                  Search
                </button>
              </form>
            </search>
          ) : null}
          <nav aria-label="Docs">
            <a
              class={`${NAV_LINK} font-bold`}
              href={section.url}
              aria-current={section.key === model.key ? 'page' : undefined}
            >
              {section.name}
            </a>
            <Tree page={section} nav={nav} model={model} open={open} />
          </nav>
        </aside>
        <article class="min-w-0 max-w-3xl">
          {trail.length > 0 ? (
            <nav aria-label="Breadcrumbs">
              <ol class="mb-3 flex flex-wrap gap-x-2 gap-y-1 text-sm">
                {trail.map((page) => (
                  <li class="not-first:before:mr-2 not-first:before:text-muted not-first:before:content-['/']">
                    <a class="link" href={page.url}>
                      {page.name}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <h1 class="mb-3 text-3xl font-medium tracking-tight text-balance sm:text-4xl">
            {model.text('title') || model.name}
          </h1>
          {model.hasValue('standfirst') ? (
            <p class="mb-8 text-lg text-pretty text-muted">{model.text('standfirst')}</p>
          ) : null}
          {headings.length > 1 ? (
            <nav
              class="mb-8 rounded-lg border border-line bg-white px-5 py-4"
              aria-label="On this page"
            >
              <h2 class="mb-2 font-semibold">On this page</h2>
              <ul class="space-y-1">
                {headings.map((heading) => (
                  <li>
                    <a class="link" href={`#${heading.id}`}>
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {children}
          {previous || next ? (
            <nav class="mt-12 flex flex-col gap-4 sm:flex-row" aria-label="Previous and next">
              {previous ? (
                <a class={PAGER_LINK} href={previous.url} rel="prev">
                  <span class="block text-xs font-normal text-muted">Previous</span> {previous.name}
                </a>
              ) : null}
              {next ? (
                <a class={`${PAGER_LINK} sm:ml-auto sm:text-right`} href={next.url} rel="next">
                  <span class="block text-xs font-normal text-muted">Next</span> {next.name}
                </a>
              ) : null}
            </nav>
          ) : null}
        </article>
      </div>
    </Layout>
  )
}
