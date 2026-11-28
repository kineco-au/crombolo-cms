import { caps, display, prose, shell } from '@/lib/classes'
import { cms } from '@/lib/cms'
import { elements, image, type Page, richText, specOf, text } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { AppLink } from './app-link'
import { TastingNotes } from './bottling'
import { Picture } from './picture'
import { RichText } from './rich-text'
import { Eyebrow, Standfirst } from './section-intro'

/** The path above this one: the range a bottling sits in. */
const parentPath = (path: string) => path.replace(/[^/]+\/?$/, '') || '/'

export function Expression({ page }: { page: Page }) {
  const range = useLoad(page.route.path, () => cms.item(parentPath(page.route.path)))
  return (
    <article
      className={`${shell} grid items-start gap-10 pt-12 pb-16 md:grid-cols-[minmax(0,2fr)_3fr] md:gap-16 md:pt-16`}
    >
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
        <h1 className={`${display} mt-3 text-5xl leading-none md:text-6xl`}>
          {text(page, 'title')}
        </h1>
        {text(page, 'summary') ? <Standfirst>{text(page, 'summary')}</Standfirst> : null}
        <RichText value={richText(page, 'bodyText')} className={`${prose} mt-5`} />
        <TastingNotes notes={elements(page, 'tastingNotes')} />
        {range ? (
          <p className={`${caps} mt-10 text-brass-deep`}>
            <AppLink
              className="underline decoration-brass/50 underline-offset-4 hover:decoration-brass-deep"
              href={range.route.path}
            >
              Back to {text(range, 'title') || range.name}
            </AppLink>
          </p>
        ) : null}
      </div>
    </article>
  )
}
