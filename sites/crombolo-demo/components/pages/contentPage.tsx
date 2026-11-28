import { type BlockItem, Blocks, type PageProps } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'
import { StepLinks, StepMenu, stepsOf } from '../shared/step-links.tsx'

export default async function ContentPage(props: PageProps) {
  const { model } = props
  const image = (await model.media('image'))[0]
  const guide = stepsOf(props).length > 0
  return (
    <Layout {...props}>
      <PageHeader model={model} narrow={!guide} />
      <div
        class={
          guide
            ? `page-column grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-[14rem_minmax(0,46rem)]`
            : 'text-column'
        }
      >
        {guide ? <StepMenu {...props} /> : null}
        <div>
          {image ? (
            <img
              class="wide-image"
              src={image.cropUrl({ width: 1200, height: 640 })}
              alt={image.name}
            />
          ) : null}
          <Blocks items={model.value('sections') as BlockItem[]} />
          <div class="prose-site">{model.html('body')}</div>
          <StepLinks {...props} />
        </div>
      </div>
    </Layout>
  )
}
