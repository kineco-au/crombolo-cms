import { RichText } from '@crombolo/next-integration/components'
import Link from 'next/link'
import { elements, image, type Page, richText, specOf, text } from '@/lib/content'
import { crombolo } from '@/lib/crombolo'
import { TastingNotes } from './bottling'
import { Picture } from './picture'
import { Eyebrow, Standfirst } from './section-intro'

/** The path above this one: the range a bottling sits in. */
const parentPath = (path: string) => path.replace(/[^/]+\/?$/, '') || '/'

export async function Expression({ page }: { page: Page }) {
  const range = await crombolo.page(parentPath(page.route.path))
  return (
    <article className="page-column grid items-start gap-10 pt-12 pb-16 md:grid-cols-[minmax(0,2fr)_3fr] md:gap-16 md:pt-16">
      <div className="border border-line bg-foam">
        <Picture
          media={image(page, 'bottleImage')}
          className="h-auto w-full"
          sizes="(min-width: 48rem) 40vw, 100vw"
          priority
        />
      </div>
      <div className="md:pt-4">
        <Eyebrow>{specOf(page)}</Eyebrow>
        <h1 className="heading-display mt-3 text-5xl leading-none md:text-6xl">
          {text(page, 'title')}
        </h1>
        {text(page, 'summary') ? <Standfirst>{text(page, 'summary')}</Standfirst> : null}
        <RichText value={richText(page, 'bodyText')} className="prose-site mt-5" />
        <TastingNotes notes={elements(page, 'tastingNotes')} />
        {range.ok ? (
          <p className="caps mt-10 text-brass-deep">
            <Link
              className="underline decoration-brass/50 underline-offset-4 hover:decoration-brass-deep"
              href={range.value.route.path}
            >
              Back to {text(range.value, 'title') || range.value.name}
            </Link>
          </p>
        ) : null}
      </div>
    </article>
  )
}
