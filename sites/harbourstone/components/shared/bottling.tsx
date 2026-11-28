import type { PublishedContent, PublishedElement } from '@crombolo/crombolo'
import { Eyebrow } from './section-intro.tsx'

/**
 * The line over a bottling's name: kind, strength, and either an age or a
 * batch. Composed here rather than typed into a field, so an editor who changes
 * the age does not also have to remember to change a string that repeats it.
 */
export function specOf(bottling: PublishedContent): string {
  const parts = [bottling.text('kind'), bottling.text('abv')]
  if (bottling.hasValue('age')) parts.push(`${bottling.text('age')} years`)
  else if (bottling.hasValue('batch')) parts.push(`Batch ${bottling.text('batch')}`)
  return parts.filter(Boolean).join(' · ')
}

export function TastingNotes({ notes }: { notes: PublishedElement[] }) {
  if (notes.length === 0) return null
  return (
    <dl class="mt-6 grid gap-3">
      {notes.map((note) => (
        <div>
          <dt class="text-sm font-medium">{note.text('aspect')}</dt>
          <dd class="text-sm text-muted">{note.text('note')}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * One bottling, as it appears in a list. `detailed` is what the range page
 * shows and the home page does not: the bottle itself and the tasting notes.
 */
export async function BottlingCard({
  bottling,
  detailed,
}: {
  bottling: PublishedContent
  detailed?: boolean
}) {
  const bottle = (await bottling.media('bottleImage'))[0]
  const notes = (bottling.value('tastingNotes') ?? []) as PublishedElement[]
  return (
    <li class="flex flex-col border border-line bg-card">
      {detailed && bottle ? (
        <a class="block bg-foam" href={bottling.url}>
          <img
            class="h-96 w-full object-cover"
            src={bottle.cropUrl({ width: 760, height: 1140 })}
            alt={bottle.name}
          />
        </a>
      ) : null}
      <div class="p-6">
        <Eyebrow>{specOf(bottling)}</Eyebrow>
        <h3 class="heading-display mt-2 text-3xl leading-tight">
          <a
            class="no-underline hover:text-brass-deep motion-safe:transition-colors"
            href={bottling.url}
          >
            {bottling.text('title')}
          </a>
        </h3>
        {bottling.hasValue('summary') ? (
          <p class="mt-3 text-muted">{bottling.text('summary')}</p>
        ) : null}
        {detailed ? <TastingNotes notes={notes} /> : null}
      </div>
    </li>
  )
}
