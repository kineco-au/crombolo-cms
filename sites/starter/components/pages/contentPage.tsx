import type { PageProps } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'

/** A main column and a sidebar; with nothing in the sidebar, the main column takes the width. */
export default function ContentPage(props: PageProps) {
  const { model } = props
  const sidebar = model.hasValue('sidebarText')
  return (
    <Layout {...props}>
      <div class={sidebar ? 'grid gap-12 md:grid-cols-[2fr_1fr]' : 'max-w-3xl'}>
        <article>
          <h1 class="page-title">{model.text('title') || model.name}</h1>
          {model.hasValue('intro') ? (
            <p class="mb-6 text-xl/relaxed text-muted">{model.text('intro')}</p>
          ) : null}
          <div class="prose-site">{model.html('bodyText')}</div>
        </article>
        {sidebar ? (
          <aside class="self-start rounded-lg bg-surface p-6">
            {model.hasValue('sidebarHeading') ? (
              <h2 class="mb-2 text-lg font-semibold">{model.text('sidebarHeading')}</h2>
            ) : null}
            <div class="prose-site prose-sm">{model.html('sidebarText')}</div>
          </aside>
        ) : null}
      </div>
    </Layout>
  )
}
