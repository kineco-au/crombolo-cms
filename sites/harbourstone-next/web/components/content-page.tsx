import { RichText } from '@crombolo/next-integration/components'
import { prose, shell } from '@/lib/classes'
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
      <section
        className={`${shell} grid items-center gap-10 py-20 md:grid-cols-2 md:gap-16 md:py-28`}
      >
        <Picture media={image(page, 'heroImage')} className="h-80 w-full object-cover md:h-112" />
        <div>
          <SectionIntro
            eyebrow={text(page, 'sectionEyebrow')}
            heading={text(page, 'sectionHeading')}
          />
          <RichText value={richText(page, 'bodyText')} className={`${prose} mt-5`} />
        </div>
      </section>
      {highlights?.items.length ? (
        <section className="bg-sea py-20 text-foam md:py-28">
          <div className={`${shell} grid items-center gap-10 md:grid-cols-2 md:gap-16`}>
            <div>
              <SectionIntro
                eyebrow={text(page, 'highlightsEyebrow')}
                heading={text(page, 'highlightsHeading')}
                tone="light"
              />
              <HighlightRows value={highlights} />
            </div>
            <Picture
              media={image(page, 'highlightsImage')}
              className="h-80 w-full object-cover md:h-112"
            />
          </div>
        </section>
      ) : null}
    </>
  )
}
