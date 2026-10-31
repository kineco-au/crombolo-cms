import type { PageProps } from '@crombolo/crombolo'
import { displayDate } from '../shared/articles.tsx'
import { Layout } from '../shared/layout.tsx'

export default async function Article({ model, nav }: PageProps) {
  const image = (await model.media('heroImage'))[0]
  const section = nav.parent(model)
  const topics = (model.value('topics') ?? []) as string[]
  return (
    <Layout model={model} nav={nav}>
      <article class="story">
        <header class="story__header">
          {section ? (
            <p class="kicker">
              <a href={section.url}>{section.name}</a>
            </p>
          ) : null}
          <h1>{model.text('title')}</h1>
          <p class="standfirst">{model.text('standfirst')}</p>
          <p class="meta">
            {model.text('byline')}
            {model.hasValue('publishedOn') ? ` · ${displayDate(model)}` : ''}
          </p>
        </header>
        {image ? (
          <figure class="story__figure">
            <img
              src={image.cropUrl({ width: 1400 })}
              alt={model.text('imageCaption') || image.name}
            />
            <figcaption>
              {model.text('imageCaption')}
              {model.hasValue('imageCredit') ? (
                <span class="credit"> {model.text('imageCredit')}</span>
              ) : null}
            </figcaption>
          </figure>
        ) : null}
        {model.hasValue('whyItMatters') ? (
          <aside class="why">
            <h2>Why it matters</h2>
            <p>{model.text('whyItMatters')}</p>
          </aside>
        ) : null}
        <div class="prose">{model.html('bodyText')}</div>
        {model.hasValue('sources') ? (
          <section class="sources">
            <h2>Sources</h2>
            {model.html('sources')}
          </section>
        ) : null}
        {topics.length > 0 ? (
          <ul class="topics" aria-label="Topics">
            {topics.map((topic) => (
              <li>{topic}</li>
            ))}
          </ul>
        ) : null}
      </article>
    </Layout>
  )
}
