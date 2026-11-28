import type { ApiElement } from '@crombolo/next-integration'
import Link from 'next/link'
import { caps, display } from '@/lib/classes'
import { elements, hrefOf, image, type Page, specOf, text } from '@/lib/content'
import { Picture } from './picture'

export function TastingNotes({ notes }: { notes: ApiElement[] }) {
  if (notes.length === 0) return null
  return (
    <dl className="mt-6 grid gap-3 text-sm">
      {notes.map((note) => (
        <div key={note.id}>
          <dt className="font-medium">{text(note, 'aspect')}</dt>
          <dd className="text-muted">{text(note, 'note')}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One bottling in a list; `detailed` adds the bottle and its tasting notes. */
export function BottlingCard({ bottling, detailed }: { bottling: Page; detailed?: boolean }) {
  const bottle = image(bottling, 'bottleImage')
  return (
    <li
      className={`border border-line bg-card ${detailed ? 'grid sm:grid-cols-[minmax(0,2fr)_3fr]' : ''}`}
    >
      {detailed && bottle ? (
        <Link className="block bg-foam" href={hrefOf(bottling)}>
          <Picture
            media={bottle}
            className="h-96 w-full object-cover sm:h-full"
            sizes="(min-width: 48rem) 20vw, 100vw"
          />
        </Link>
      ) : null}
      <div className="p-6">
        <p className={`${caps} text-brass-deep`}>{specOf(bottling)}</p>
        <h3 className={`${display} mt-2 text-3xl`}>
          <Link
            className="hover:text-brass-deep motion-safe:transition-colors"
            href={hrefOf(bottling)}
          >
            {text(bottling, 'title') || bottling.name}
          </Link>
        </h3>
        {text(bottling, 'summary') ? (
          <p className="mt-3 text-muted">{text(bottling, 'summary')}</p>
        ) : null}
        {detailed ? <TastingNotes notes={elements(bottling, 'tastingNotes')} /> : null}
      </div>
    </li>
  )
}
