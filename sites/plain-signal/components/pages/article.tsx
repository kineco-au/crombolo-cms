import type { PageProps } from '@crombolo/crombolo'
import { displayDate } from '../shared/articles.tsx'
import { Layout } from '../shared/layout.tsx'

const label = 'mb-2 text-xs font-semibold tracking-widest text-muted uppercase'

export default async function Article({ model, nav }: PageProps) {
  const image = (await model.media('heroImage'))[0]
  const section = nav.parent(model)
  const topics = (model.value('topics') ?? []) as string[]
  return (
    <Layout model={model} nav={nav}>
      <article>
        <header class="mx-auto mb-8 max-w-2xl">
          {section ? (
            <p class="kicker">
              <a href={section.url}>{section.name}</a>
            </p>
          ) : null}
          <h1 class="headline">{model.text('title')}</h1>
          <p class="standfirst">{model.text('standfirst')}</p>
          <p class="text-sm text-muted">
            {model.text('byline')}
            {model.hasValue('publishedOn') ? ` · ${displayDate(model)}` : ''}
          </p>
        </header>
        {image ? (
          <figure class="mx-auto mb-10 max-w-4xl">
            <img
              src={image.cropUrl({ width: 1400 })}
              alt={model.text('imageCaption') || image.name}
              class="w-full rounded"
            />
            <figcaption class="mt-2.5 text-sm text-muted">
              {model.text('imageCaption')}
              {model.hasValue('imageCredit') ? (
                <span class="italic"> {model.text('imageCredit')}</span>
              ) : null}
            </figcaption>
          </figure>
        ) : null}
        {model.hasValue('whyItMatters') ? (
          <aside class="mx-auto mb-8 max-w-2xl rounded-r border-l-3 border-accent bg-panel px-5 py-4">
            <h2 class={label}>Why it matters</h2>
            <p>{model.text('whyItMatters')}</p>
          </aside>
        ) : null}
        <div class="prose-site mx-auto max-w-2xl prose-lg">{model.html('bodyText')}</div>
        {model.hasValue('sources') ? (
          <section class="mx-auto mt-10 max-w-2xl border-t border-rule pt-5">
            <h2 class={label}>Sources</h2>
            <div class="prose-site prose-sm">{model.html('sources')}</div>
          </section>
        ) : null}
        {topics.length > 0 ? (
          <ul class="mx-auto mt-6 flex max-w-2xl flex-wrap gap-2" aria-label="Topics">
            {topics.map((topic) => (
              <li class="rounded-full border border-rule px-3 py-0.5 text-sm text-muted">
                {topic}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </Layout>
  )
}
