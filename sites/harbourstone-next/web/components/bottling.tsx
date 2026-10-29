import type { ApiElement } from '@crombolo/next-integration'
import Link from 'next/link'
import { elements, hrefOf, image, type Page, specOf, text } from '@/lib/content'
import { Picture } from './picture'

export function TastingNotes({ notes }: { notes: ApiElement[] }) {
  if (notes.length === 0) return null
  return (
    <dl className="tasting">
      {notes.map((note) => (
        <div key={note.id}>
          <dt>{text(note, 'aspect')}</dt>
          <dd>{text(note, 'note')}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One bottling in a list; `detailed` adds the bottle and its tasting notes. */
export function BottlingCard({ bottling, detailed }: { bottling: Page; detailed?: boolean }) {
  const bottle = image(bottling, 'bottleImage')
  return (
    <li className="bottling-card">
      {detailed && bottle ? (
        <Link className="bottling-card__image" href={hrefOf(bottling)}>
          <Picture media={bottle} sizes="(min-width: 48rem) 25vw, 50vw" />
        </Link>
      ) : null}
      <div className="bottling-card__text">
        <p className="eyebrow">{specOf(bottling)}</p>
        <h3>
          <Link href={hrefOf(bottling)}>{text(bottling, 'title') || bottling.name}</Link>
        </h3>
        {text(bottling, 'summary') ? <p>{text(bottling, 'summary')}</p> : null}
        {detailed ? <TastingNotes notes={elements(bottling, 'tastingNotes')} /> : null}
      </div>
    </li>
  )
}
