import type { PageProps } from '@crombolo/crombolo'
import { HighlightRows, highlightsOf } from '../shared/highlights.tsx'
import { Layout } from '../shared/layout.tsx'
import { PageHeader, Prose, SectionIntro } from '../shared/section-intro.tsx'

export default async function ContentPage({ model, nav }: PageProps) {
  const image = (await model.media('heroImage'))[0]
  const highlights = highlightsOf(model.value('highlights'))
  const highlightsImage = (await model.media('highlightsImage'))[0]
  return (
    <Layout model={model} nav={nav}>
      <PageHeader model={model} />

      <section class="page-column grid items-center gap-10 py-20 md:grid-cols-2 md:gap-12 md:py-28">
        {image ? (
          <img
            class="h-112 w-full object-cover"
            src={image.cropUrl({ width: 1200, height: 800 })}
            alt={image.name}
          />
        ) : null}
        <div>
          <SectionIntro
            eyebrow={model.text('sectionEyebrow')}
            heading={model.text('sectionHeading')}
          />
          <Prose>{model.html('bodyText')}</Prose>
        </div>
      </section>

      {highlights.length > 0 ? (
        <section class="bg-sea py-20 text-foam md:py-28">
          <div class="page-column grid items-center gap-10 md:grid-cols-2 md:gap-12">
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
                class="h-112 w-full object-cover"
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
