import type { PageProps } from '@crombolo/crombolo'
import { ArticleCard, articlesUnder } from '../shared/articles.tsx'
import { Layout } from '../shared/layout.tsx'

export default function SectionPage({ model, nav }: PageProps) {
  const articles = articlesUnder(nav, nav.children(model))
  return (
    <Layout model={model} nav={nav}>
      <header class="mb-10 border-b border-rule pb-4">
        <div class="max-w-2xl">
          <h1 class="headline">{model.text('title')}</h1>
          {model.hasValue('standfirst') ? (
            <p class="standfirst">{model.text('standfirst')}</p>
          ) : null}
        </div>
      </header>
      <div class="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => (
          <ArticleCard article={article} nav={nav} />
        ))}
      </div>
    </Layout>
  )
}
