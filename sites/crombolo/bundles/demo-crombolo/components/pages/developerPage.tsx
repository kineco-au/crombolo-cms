import type { PageProps } from '@crombolo/crombolo'
import { FeatureCards } from '../shared/features.tsx'
import { Layout } from '../shared/layout.tsx'
import { elementsOf, repositoryUrl } from '../shared/site.tsx'
import { BUTTON_SOLID, CODE, CONTAINER, NARROW, PROSE, SECTION_HEADING } from '../shared/styles.tsx'

export default function DeveloperPage(props: PageProps) {
  const { model, nav } = props
  const steps = elementsOf(model, 'steps')
  return (
    <Layout {...props}>
      <header class="bg-linear-to-b from-terracotta-deep to-terracotta-text pt-14 pb-16 text-center text-white md:pt-20 md:pb-24">
        <div class={NARROW}>
          {model.hasValue('eyebrow') ? (
            <p class="text-sm font-semibold tracking-widest uppercase">{model.text('eyebrow')}</p>
          ) : null}
          <h1 class="mt-2 mb-4 text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            {model.text('title')}
          </h1>
          {model.hasValue('standfirst') ? (
            <p class="mx-auto max-w-2xl text-lg text-pretty sm:text-xl">
              {model.text('standfirst')}
            </p>
          ) : null}
        </div>
      </header>

      {/* A section with no heading is left out, so a reference page shows only its prose. */}
      {model.hasValue('codeHeading') ? (
        <section class="py-14 md:py-20">
          <div
            class={`${CONTAINER} grid items-start gap-10 *:min-w-0 md:grid-cols-[2fr_3fr] md:gap-14`}
          >
            <div>
              <h2 class={SECTION_HEADING}>{model.text('codeHeading')}</h2>
              {model.hasValue('codeIntro') ? (
                <p class="text-lg text-muted">{model.text('codeIntro')}</p>
              ) : null}
            </div>
            {/* Text, not markup: the sample is escaped, so its tags show as written. */}
            {model.hasValue('codeSample') ? (
              <pre class={CODE}>
                <code>{model.text('codeSample')}</code>
              </pre>
            ) : null}
          </div>
        </section>
      ) : null}

      {model.hasValue('toolkitHeading') ? (
        <section class="bg-white py-14 md:py-20">
          <div class={CONTAINER}>
            <h2 class={`${SECTION_HEADING} mb-8`}>{model.text('toolkitHeading')}</h2>
            <FeatureCards items={elementsOf(model, 'toolkit')} />
          </div>
        </section>
      ) : null}

      <section id="getting-started" class="py-14 md:py-20">
        <div class={NARROW}>
          {model.hasValue('stepsHeading') ? (
            <h2 class={SECTION_HEADING}>{model.text('stepsHeading')}</h2>
          ) : null}
          {steps.length > 0 ? (
            <ol class="my-8 space-y-8">
              {steps.map((step, index) => (
                <li class="relative pl-14">
                  <span
                    class="absolute top-0 left-0 grid size-9 place-items-center rounded-full bg-terracotta font-bold text-white"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <h3 class="mb-1 pt-1 text-xl font-medium">{step.text('heading')}</h3>
                  {step.text('detail') ? <p class="text-muted">{step.text('detail')}</p> : null}
                  {step.text('command') ? (
                    <pre class={`${CODE} mt-4`}>
                      <code>{step.text('command')}</code>
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          <div class={PROSE}>{model.html('nextSteps')}</div>
          <p class="mt-8">
            <a class={BUTTON_SOLID} href={repositoryUrl(nav)}>
              View the source on GitHub
            </a>
          </p>
        </div>
      </section>
    </Layout>
  )
}
