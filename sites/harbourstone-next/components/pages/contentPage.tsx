import type { PageProps } from '@crombolo/crombolo'
import { HighlightRows, highlightsOf } from '../shared/highlights.tsx'
import { Layout } from '../shared/layout.tsx'
import { PageHeader, SectionIntro } from '../shared/section-intro.tsx'

export default async function ContentPage({ model, nav }: PageProps) {
  const image = (await model.media('heroImage'))[0]
  const highlights = highlightsOf(model.value('highlights'))
  const highlightsImage = (await model.media('highlightsImage'))[0]
  return (
    <Layout model={model} nav={nav}>
      <PageHeader model={model} />

      <section class="split split--image-first">
        {image ? (
          <img
            class="split__image"
            src={image.cropUrl({ width: 1200, height: 800 })}
            alt={image.name}
          />
        ) : null}
        <div>
          <SectionIntro
            eyebrow={model.text('sectionEyebrow')}
            heading={model.text('sectionHeading')}
          />
          <div class="prose">{model.html('bodyText')}</div>
        </div>
      </section>

      {highlights.length > 0 ? (
        <section class="band band--dark">
          <div class="split">
            <div>
              <SectionIntro
                eyebrow={model.text('highlightsEyebrow')}
                heading={model.text('highlightsHeading')}
                tone="light"
              />
              <HighlightRows items={highlights} />
            </div>
            {highlightsImage ? (
              <img
                class="split__image"
                src={highlightsImage.cropUrl({ width: 1200, height: 800 })}
                alt={highlightsImage.name}
              />
            ) : null}
          </div>
        </section>
      ) : null}
    </Layout>
  )
}
