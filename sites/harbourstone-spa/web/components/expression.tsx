import { cms } from '@/lib/cms'
import { elements, image, type Page, richText, specOf, text } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { AppLink } from './app-link'
import { TastingNotes } from './bottling'
import { Picture } from './picture'
import { RichText } from './rich-text'
import { Eyebrow } from './section-intro'

/** The path above this one: the range a bottling sits in. */
const parentPath = (path: string) => path.replace(/[^/]+\/?$/, '') || '/'

export function Expression({ page }: { page: Page }) {
  const range = useLoad(page.route.path, () => cms.item(parentPath(page.route.path)))
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
        {range ? (
          <p className="back">
            <AppLink href={range.route.path}>Back to {text(range, 'title') || range.name}</AppLink>
          </p>
        ) : null}
      </div>
    </article>
  )
}
