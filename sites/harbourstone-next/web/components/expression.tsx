import { RichText } from '@crombolo/next-integration/components'
import Link from 'next/link'
import { elements, image, type Page, richText, specOf, text } from '@/lib/content'
import { crombolo } from '@/lib/crombolo'
import { TastingNotes } from './bottling'
import { Picture } from './picture'
import { Eyebrow } from './section-intro'

/** The path above this one: the range a bottling sits in. */
const parentPath = (path: string) => path.replace(/[^/]+\/?$/, '') || '/'

export async function Expression({ page }: { page: Page }) {
  const range = await crombolo.page(parentPath(page.route.path))
  return (
    <article className="bottling">
      <div className="bottling__image">
        <Picture
          media={image(page, 'bottleImage')}
          sizes="(min-width: 48rem) 40vw, 100vw"
          priority
        />
      </div>
      <div className="bottling__text">
        <Eyebrow>{specOf(page)}</Eyebrow>
        <h1>{text(page, 'title')}</h1>
        {text(page, 'summary') ? <p className="standfirst">{text(page, 'summary')}</p> : null}
        <RichText value={richText(page, 'bodyText')} className="prose" />
        <TastingNotes notes={elements(page, 'tastingNotes')} />
        {range.ok ? (
          <p className="back">
            <Link href={range.value.route.path}>
              Back to {text(range.value, 'title') || range.value.name}
            </Link>
          </p>
        ) : null}
      </div>
    </article>
  )
}
