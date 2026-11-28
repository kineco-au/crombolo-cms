import type { PageProps } from '@crombolo/crombolo'
import { BottlingCard } from '../shared/bottling.tsx'
import { Figures, highlightsOf } from '../shared/highlights.tsx'
import { Layout } from '../shared/layout.tsx'
import { Eyebrow, Prose, SectionIntro } from '../shared/section-intro.tsx'

export default async function HomePage({ model, nav }: PageProps) {
  const hero = (await model.media('heroImage'))[0]
  const styleImage = (await model.media('styleImage'))[0]
  // The range is whichever child is the list, rather than a hard-coded path:
  // rename or move it in the backoffice and these two sections follow.
  const range = nav.children(model).find((child) => child.contentType.alias === 'whiskyList')
  const bottlings = range ? nav.children(range) : []
  return (
    <Layout model={model} nav={nav}>
      <section class="relative flex min-h-[88vh] items-end bg-sea pt-28 pb-16 text-foam">
        {hero ? (
          <img
            class="absolute inset-0 size-full object-cover"
            src={hero.cropUrl({ width: 1600, height: 900 })}
            alt={hero.name}
          />
        ) : null}
        <div
          class="absolute inset-0 bg-linear-to-t from-sea/90 via-sea/50 via-35% to-sea/10"
          aria-hidden="true"
        />
        <div class="page-column relative">
          <Eyebrow tone="light">{model.text('eyebrow')}</Eyebrow>
          <h1 class="heading-display mt-4 text-6xl leading-none sm:text-7xl lg:text-8xl">
            {model.text('title')}
          </h1>
          <p class="mt-5 max-w-lg text-lg">{model.text('strapline')}</p>
          {range && model.hasValue('heroCtaLabel') ? (
            <a class="btn-light mt-8" href={range.url}>
              {model.text('heroCtaLabel')}
            </a>
          ) : null}
        </div>
      </section>

      <section class="page-column grid items-center gap-10 py-20 md:grid-cols-2 md:gap-12 md:py-28">
        <div>
          <SectionIntro eyebrow={model.text('styleEyebrow')} heading={model.text('styleHeading')} />
          <Prose>{model.html('styleIntro')}</Prose>
          <Figures items={highlightsOf(model.value('stats'))} />
        </div>
        {styleImage ? (
          <img
            class="h-112 w-full object-cover"
            src={styleImage.cropUrl({ width: 1200, height: 800 })}
            alt={styleImage.name}
          />
        ) : null}
      </section>

      {range ? (
        <section class="bg-foam py-20 md:py-28">
          <div class="page-column">
            <SectionIntro
              eyebrow={model.text('rangeEyebrow')}
              heading={model.text('rangeHeading')}
            />
            <ul class="mt-10 grid gap-5 md:grid-cols-2">
              {bottlings.map((bottling) => (
                <BottlingCard bottling={bottling} />
              ))}
            </ul>
            {model.hasValue('rangeCtaLabel') ? (
              <a class="btn-ink mt-8" href={range.url}>
                {model.text('rangeCtaLabel')}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}
    </Layout>
  )
}
