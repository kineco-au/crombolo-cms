import type { PageProps } from '@crombolo/crombolo'
import { ArticleCard, articlesUnder } from '../shared/articles.tsx'
import { Layout } from '../shared/layout.tsx'

export default function SectionPage({ model, nav }: PageProps) {
  const articles = articlesUnder(nav, nav.children(model))
  return (
    <Layout model={model} nav={nav}>
      <header class="page-header">
        <h1>{model.text('title')}</h1>
        {model.hasValue('standfirst') ? <p class="standfirst">{model.text('standfirst')}</p> : null}
      </header>
      <div class="grid">
        {articles.map((article) => (
          <ArticleCard article={article} nav={nav} />
        ))}
      </div>
    </Layout>
  )
}
