import type { PageProps, PublishedElement } from '@crombolo/crombolo'
import { formatDate } from '../shared/dates.ts'
import { Layout } from '../shared/layout.tsx'

export default async function BlogPost(props: PageProps) {
  const { model, nav, dictionary, culture } = props
  const image = (await model.media('image'))[0]
  const author = ((model.value('author') ?? []) as PublishedElement[])[0]
  const tags = (model.value('tags') ?? []) as string[]
  const list = nav.parent(model)
  return (
    <Layout {...props}>
      <article class={`text-column pt-12`}>
        <p class="eyebrow">
          {formatDate(model.value('publishDate'), culture)}
          {author ? ` · ${author.text('fullName')}` : ''}
        </p>
        <h1 class="heading-display">{model.text('title')}</h1>
        <p class="lede">{model.text('excerpt')}</p>
        {image ? (
          <img
            class="wide-image"
            src={image.cropUrl({ width: 1200, height: 640 })}
            alt={image.name}
          />
        ) : null}
        <div class="prose-site">{model.html('body')}</div>
        {list && tags.length > 0 ? (
          <nav class={`filter-bar mt-10`} aria-label={dictionary('blog.tags')}>
            {tags.map((tag) => (
              <a class="chip" href={`${list.url}?tag=${encodeURIComponent(tag)}`}>
                {tag}
              </a>
            ))}
          </nav>
        ) : null}
      </article>
    </Layout>
  )
}
