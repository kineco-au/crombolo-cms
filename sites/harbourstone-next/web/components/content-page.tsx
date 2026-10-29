import { RichText } from '@crombolo/next-integration/components'
import { blocks, image, type Page, richText, text } from '@/lib/content'
import { HighlightRows } from './highlights'
import { Picture } from './picture'
import { PageHeader, SectionIntro } from './section-intro'

/** Prose with an image, and a dark band of highlights that disappears when there are none. */
export function ContentPage({ page }: { page: Page }) {
  const highlights = blocks(page, 'highlights')
  return (
    <>
      <PageHeader page={page} />
      <section className="split split--image-first">
        <Picture media={image(page, 'heroImage')} className="split__image" />
        <div>
          <SectionIntro
            eyebrow={text(page, 'sectionEyebrow')}
            heading={text(page, 'sectionHeading')}
          />
          <RichText value={richText(page, 'bodyText')} className="prose" />
        </div>
      </section>
      {highlights?.items.length ? (
        <section className="band band--dark">
          <div className="split">
            <div>
              <SectionIntro
                eyebrow={text(page, 'highlightsEyebrow')}
                heading={text(page, 'highlightsHeading')}
                tone="light"
              />
              <HighlightRows value={highlights} />
            </div>
            <Picture media={image(page, 'highlightsImage')} className="split__image" />
          </div>
        </section>
      ) : null}
    </>
  )
}
