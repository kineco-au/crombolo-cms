import type { PageProps } from '@crombolo/crombolo'
import { ArticleCard, articlesUnder } from '../shared/articles.tsx'
import { Layout } from '../shared/layout.tsx'

export default function HomePage({ model, nav }: PageProps) {
  const [lead, ...rest] = articlesUnder(nav, nav.children(model))
  return (
    <Layout model={model} nav={nav}>
      {model.hasValue('introduction') ? (
        <p class="introduction">{model.text('introduction')}</p>
      ) : null}
      {lead ? <ArticleCard article={lead} nav={nav} lead /> : null}
      <div class="grid">
        {rest.map((article) => (
          <ArticleCard article={article} nav={nav} />
        ))}
      </div>
    </Layout>
  )
}
