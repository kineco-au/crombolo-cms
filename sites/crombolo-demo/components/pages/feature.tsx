import type { PageProps } from '@crombolo/crombolo'
import { categoryKey } from '../shared/categories.ts'
import { Layout } from '../shared/layout.tsx'
import { eyebrow, h1, lead, narrow, prose, wideImage } from '../shared/styles.ts'

export default async function Feature(props: PageProps) {
  const { model, nav, dictionary } = props
  const image = (await model.media('image'))[0]
  const list = nav.parent(model)
  const category = String(model.value('category'))
  return (
    <Layout {...props}>
      <article class={`${narrow} pt-12`}>
        {list ? (
          <p class={eyebrow}>
            <a
              class="text-green no-underline hover:text-terracotta"
              href={`${list.url}?category=${category}`}
            >
              {dictionary(categoryKey(category))}
            </a>
          </p>
        ) : null}
        <h1 class={h1}>{model.text('title')}</h1>
        <p class={lead}>{model.text('summary')}</p>
        {image ? (
          <img
            class={wideImage}
            src={image.cropUrl({ width: 1200, height: 640 })}
            alt={image.name}
          />
        ) : null}
        <div class={prose}>{model.html('body')}</div>
      </article>
    </Layout>
  )
}
