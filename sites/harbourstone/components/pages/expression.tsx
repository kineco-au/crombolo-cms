import type { PageProps, PublishedElement } from '@crombolo/crombolo'
import { specOf, TastingNotes } from '../shared/bottling.tsx'
import { display, shell } from '../shared/classes.ts'
import { Layout } from '../shared/layout.tsx'
import { RemindMe } from '../shared/remind-me.tsx'
import { Eyebrow, Prose, Standfirst } from '../shared/section-intro.tsx'

export default async function Expression({ model, nav }: PageProps) {
  const bottle = (await model.media('bottleImage'))[0]
  const notes = (model.value('tastingNotes') ?? []) as PublishedElement[]
  const range = nav.parent(model)
  return (
    <Layout model={model} nav={nav}>
      <article
        class={`${shell} grid items-start gap-10 pt-12 pb-16 md:grid-cols-[minmax(0,2fr)_3fr] md:gap-12`}
      >
        <div class="border border-line bg-foam">
          {bottle ? (
            <img
              class="w-full"
              src={bottle.cropUrl({ width: 760, height: 1140 })}
              alt={bottle.name}
            />
          ) : null}
        </div>
        <div>
          <Eyebrow>{specOf(model)}</Eyebrow>
          <h1 class={`${display} mt-3 text-5xl leading-none md:text-6xl`}>{model.text('title')}</h1>
          {model.hasValue('summary') ? <Standfirst>{model.text('summary')}</Standfirst> : null}
          <Prose>{model.html('bodyText')}</Prose>
          <TastingNotes notes={notes} />
          <RemindMe name={model.text('title')} />
          {range ? (
            <p class="mt-10 text-xs font-medium tracking-caps text-brass-deep uppercase">
              <a class="hover:text-ink motion-safe:transition-colors" href={range.url}>
                Back to {range.text('title')}
              </a>
            </p>
          ) : null}
        </div>
      </article>
    </Layout>
  )
}
