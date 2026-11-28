import type { PageProps } from '@crombolo/crombolo'
import { CATEGORIES, categoryKey } from '../shared/categories.ts'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'
import { chip, eyebrow, filters, wrap } from '../shared/styles.ts'

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
      <div class={wrap}>
        <nav class={filters} aria-label={dictionary('features.filter')}>
          <a class={chip} href={model.url} aria-current={chosen ? undefined : 'true'}>
            {dictionary('features.all')}
          </a>
          {CATEGORIES.map((name) => (
            <a
              class={chip}
              href={`${model.url}?category=${name}`}
              aria-current={name === chosen ? 'true' : undefined}
            >
              {dictionary(categoryKey(name))}
            </a>
          ))}
        </nav>
        <ul class="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(async (feature) => {
            const image = (await feature.media('image'))[0]
            return (
              <li>
                {image ? (
                  <img
                    class="mb-4 rounded"
                    src={image.cropUrl({ width: 640, height: 400 })}
                    alt=""
                  />
                ) : null}
                <p class={eyebrow}>{dictionary(categoryKey(String(feature.value('category'))))}</p>
                <h2 class="font-serif text-2xl/snug font-bold">
                  <a class="text-ink no-underline hover:text-green" href={feature.url}>
                    {feature.text('title')}
                  </a>
                </h2>
                <p class="mt-2">{feature.text('summary')}</p>
              </li>
            )
          })}
        </ul>
      </div>
    </Layout>
  )
}
