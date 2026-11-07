import type { PageProps } from '@crombolo/crombolo'
import { CATEGORIES, categoryKey } from '../shared/categories.ts'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'

/** The features below this page, narrowed by `?category=` to one of `CATEGORIES`. */
export default async function FeatureList(props: PageProps) {
  const { model, nav, searchParams, dictionary } = props
  const { category } = await searchParams
  const chosen = CATEGORIES.find((known) => known === category)
  const features = nav
    .children(model)
    .filter((feature) => !chosen || feature.value('category') === chosen)
  return (
    <Layout {...props}>
      <PageHeader model={model} />
      <div class="wrap">
        <nav class="filters" aria-label={dictionary('features.filter')}>
          <a href={model.url} aria-current={chosen ? undefined : 'true'}>
            {dictionary('features.all')}
          </a>
          {CATEGORIES.map((name) => (
            <a
              href={`${model.url}?category=${name}`}
              aria-current={name === chosen ? 'true' : undefined}
            >
              {dictionary(categoryKey(name))}
            </a>
          ))}
        </nav>
        <ul class="cards">
          {features.map(async (feature) => {
            const image = (await feature.media('image'))[0]
            return (
              <li class="card">
                {image ? <img src={image.cropUrl({ width: 640, height: 400 })} alt="" /> : null}
                <p class="eyebrow">{dictionary(categoryKey(String(feature.value('category'))))}</p>
                <h2>
                  <a href={feature.url}>{feature.text('title')}</a>
                </h2>
                <p>{feature.text('summary')}</p>
              </li>
            )
          })}
        </ul>
      </div>
    </Layout>
  )
}
