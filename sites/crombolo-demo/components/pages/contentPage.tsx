import type { PageProps } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'

export default async function ContentPage(props: PageProps) {
  const { model } = props
  const image = (await model.media('image'))[0]
  return (
    <Layout {...props}>
      <PageHeader model={model} />
      <div class="wrap wrap--narrow">
        {image ? (
          <img
            class="wide-image"
            src={image.cropUrl({ width: 1200, height: 640 })}
            alt={image.name}
          />
        ) : null}
        <div class="prose">{model.html('body')}</div>
      </div>
    </Layout>
  )
}
