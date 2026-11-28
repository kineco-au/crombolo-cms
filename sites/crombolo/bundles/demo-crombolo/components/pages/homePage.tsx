import type { PageProps } from '@crombolo/crombolo'
import { CARD, CARD_HEADING, FeatureCards, FeatureChecklist } from '../shared/features.tsx'
import { Layout } from '../shared/layout.tsx'
import { Logo } from '../shared/logo.tsx'
import { developerPage, elementsOf, repositoryUrl } from '../shared/site.tsx'
import {
  BUTTON_LIGHT,
  BUTTON_OUTLINE,
  CONTAINER,
  LEAD,
  NARROW,
  PROSE,
  SECTION_HEADING,
} from '../shared/styles.tsx'

const BAND_HEADING = 'mb-3 text-3xl font-medium tracking-tight text-white text-balance md:text-4xl'
const BAND_LEAD = 'mx-auto mb-8 max-w-2xl text-lg'

export default function HomePage(props: PageProps) {
  const { model, nav } = props
  const developers = developerPage(nav)
  return (
    <Layout {...props}>
      <section class="bg-linear-to-b from-terracotta-deep to-terracotta-text pt-14 pb-16 text-center text-white md:pt-20 md:pb-24">
        <div class={CONTAINER}>
          <Logo size="large" />
          <h1 class="mt-6 mb-4 text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            {model.text('title')}
          </h1>
          {model.hasValue('strapline') ? (
            <p class="mx-auto mb-8 max-w-2xl text-lg text-pretty sm:text-xl">
              {model.text('strapline')}
            </p>
          ) : null}
          <div class="flex flex-wrap justify-center gap-3">
            {model.hasValue('heroCtaLabel') ? (
              <a class={BUTTON_LIGHT} href="#get-started">
                {model.text('heroCtaLabel')}
              </a>
            ) : null}
            <a class={BUTTON_OUTLINE} href="#why">
              Why Crombolo
            </a>
          </div>
        </div>
      </section>

      <section id="why" class="scroll-mt-16 py-14 md:py-20">
        <div class={CONTAINER}>
          <h2 class={SECTION_HEADING}>{model.text('whyHeading')}</h2>
          {model.hasValue('whyIntro') ? <p class={LEAD}>{model.text('whyIntro')}</p> : null}
          <FeatureCards items={elementsOf(model, 'reasons')} />
        </div>
      </section>

      <section id="editors" class="scroll-mt-16 bg-white py-14 md:py-20">
        <div class={CONTAINER}>
          <h2 class={SECTION_HEADING}>{model.text('editorsHeading')}</h2>
          {model.hasValue('editorsIntro') ? <p class={LEAD}>{model.text('editorsIntro')}</p> : null}
          <div class="grid items-center gap-10 *:min-w-0 md:grid-cols-2 md:gap-14">
            <FeatureChecklist items={elementsOf(model, 'editorFeatures')} />
            {model.hasValue('migrateHeading') ? (
              <aside class={`${CARD} bg-cream`}>
                <h3 class={CARD_HEADING}>{model.text('migrateHeading')}</h3>
                <div class={`${PROSE} text-muted`}>{model.html('migrateBody')}</div>
              </aside>
            ) : null}
          </div>
        </div>
      </section>

      {developers ? (
        <section class="bg-ink py-14 text-center text-arc md:py-20">
          <div class={NARROW}>
            <h2 class={BAND_HEADING}>{model.text('developersHeading')}</h2>
            {model.hasValue('developersIntro') ? (
              <p class={BAND_LEAD}>{model.text('developersIntro')}</p>
            ) : null}
            {model.hasValue('developersCtaLabel') ? (
              <a class={BUTTON_LIGHT} href={developers.url}>
                {model.text('developersCtaLabel')}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <section id="get-started" class="bg-terracotta-text py-14 text-center text-white md:py-20">
        <div class={NARROW}>
          <h2 class={BAND_HEADING}>{model.text('closingHeading')}</h2>
          {model.hasValue('closingBody') ? (
            <p class={BAND_LEAD}>{model.text('closingBody')}</p>
          ) : null}
          {model.hasValue('installCommand') ? (
            <pre class="mb-8 inline-block max-w-full overflow-x-auto rounded-lg bg-cocoa px-6 py-4 text-left font-mono text-base text-arc sm:text-lg">
              <code>{model.text('installCommand')}</code>
            </pre>
          ) : null}
          <div class="flex flex-wrap justify-center gap-3">
            <a class={BUTTON_LIGHT} href={repositoryUrl(nav)}>
              View on GitHub
            </a>
            {developers ? (
              <a class={BUTTON_OUTLINE} href={developers.url}>
                Developer guide
              </a>
            ) : null}
          </div>
        </div>
      </section>
    </Layout>
  )
}
