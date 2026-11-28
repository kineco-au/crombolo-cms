import type { PageProps } from '@crombolo/crombolo'
import { DocsLayout } from '../shared/docs.tsx'
import { CARD_HEADING } from '../shared/features.tsx'
import { LINK, PROSE } from '../shared/styles.tsx'

/** The front page of the docs: its introduction, then every top-level page and what is under it. */
export default function DocsSection(props: PageProps) {
  const { model, nav } = props
  const pages = (parent: typeof model) =>
    nav
      .children(parent, { visibleOnly: true })
      .filter((child) => child.contentType.alias === 'docsPage')
  return (
    <DocsLayout {...props}>
      {model.hasValue('body') ? <div class={PROSE}>{model.html('body')}</div> : null}
      <div class="mt-8 grid items-start gap-6 sm:grid-cols-2">
        {pages(model).map((page) => (
          <section class="rounded-xl border border-line bg-white px-6 py-5">
            <h2 class={CARD_HEADING}>
              <a class="hover:underline" href={page.url}>
                {page.name}
              </a>
            </h2>
            {page.hasValue('standfirst') ? (
              <p class="text-muted">{page.text('standfirst')}</p>
            ) : null}
            {pages(page).length > 0 ? (
              <ul class="mt-3 space-y-1">
                {pages(page).map((child) => (
                  <li>
                    <a class={LINK} href={child.url}>
                      {child.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </DocsLayout>
  )
}
