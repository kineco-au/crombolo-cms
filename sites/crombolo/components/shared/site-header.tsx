import type { Navigation, PublishedContent } from '@crombolo/crombolo'
import { Logo } from './logo.tsx'
import { developerPage, docsSection, homeOf, repositoryUrl } from './site.tsx'
import { CONTAINER } from './styles.tsx'

const NAV_LINK =
  'font-medium text-white/85 transition-colors hover:text-white motion-reduce:transition-none aria-[current=page]:text-white aria-[current=page]:underline aria-[current=page]:underline-offset-[0.3em]'

/**
 * The masthead. The home page's sections are linked by anchor through the home
 * page's own URL, so the links work from every page, not only the one they are on.
 */
export function SiteHeader({ model, nav }: { model: PublishedContent; nav: Navigation }) {
  const home = homeOf(nav)
  if (!home) return null
  const developers = developerPage(nav)
  const docs = docsSection(nav)
  const inDocs =
    docs !== undefined &&
    (docs.key === model.key || nav.ancestors(model).some((page) => page.key === docs.key))
  return (
    <header class="sticky top-0 z-10 bg-ink text-white shadow-md">
      <div class={`${CONTAINER} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3`}>
        <a class="inline-flex items-center gap-2.5 text-2xl font-bold" href={home.url}>
          <Logo />
          crombolo
        </a>
        <nav class="flex flex-wrap gap-x-6 gap-y-1" aria-label="Primary">
          <a class={NAV_LINK} href={`${home.url}#why`}>
            Why Crombolo
          </a>
          <a class={NAV_LINK} href={`${home.url}#editors`}>
            For editors
          </a>
          {developers ? (
            <a
              class={NAV_LINK}
              href={developers.url}
              aria-current={developers.key === model.key ? 'page' : undefined}
            >
              For developers
            </a>
          ) : null}
          {docs ? (
            <a class={NAV_LINK} href={docs.url} aria-current={inDocs ? 'page' : undefined}>
              Docs
            </a>
          ) : null}
          <a class={NAV_LINK} href={repositoryUrl(nav)}>
            GitHub
          </a>
        </nav>
      </div>
    </header>
  )
}
