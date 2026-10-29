import type { PageProps } from '@crombolo/crombolo'
import { BottlingCard } from '../shared/bottling.tsx'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/section-intro.tsx'

/**
 * The comparison as the CMS renders it, for preview and search: the whole
 * range. The Next.js app in web/ is where visitors choose bottlings side by side.
 */
export default function ComparisonPage({ model, nav }: PageProps) {
  const range = nav
    .root()
    .flatMap((root) => nav.children(root))
    .filter((page) => page.contentType.alias === 'whiskyList')
    .flatMap((list) => nav.children(list))
  return (
    <Layout model={model} nav={nav}>
      <PageHeader model={model} />
      <section>
        <ul class="bottlings">
          {range.map((bottling) => (
            <BottlingCard bottling={bottling} />
          ))}
        </ul>
      </section>
    </Layout>
  )
}
