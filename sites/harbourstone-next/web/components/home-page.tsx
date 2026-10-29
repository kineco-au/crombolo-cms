import { RichText } from '@crombolo/next-integration/components'
import Link from 'next/link'
import { blocks, childrenOf, hrefOf, image, type Page, richText, text } from '@/lib/content'
import { BottlingCard } from './bottling'
import { Figures } from './highlights'
import { Picture } from './picture'
import { Eyebrow, SectionIntro } from './section-intro'

export async function HomePage({ page }: { page: Page }) {
  // The range is whichever child is the list, so renaming or moving it in the backoffice is followed.
  const range = (await childrenOf(page)).find((child) => child.contentType === 'whiskyList')
  const bottlings = range ? await childrenOf(range) : []
  return (
    <>
      <section className="hero">
        <Picture media={image(page, 'heroImage')} className="hero__image" sizes="100vw" priority />
        <div className="hero__text">
          <Eyebrow tone="light">{text(page, 'eyebrow')}</Eyebrow>
          <h1>{text(page, 'title')}</h1>
          <p className="strapline">{text(page, 'strapline')}</p>
          {range && text(page, 'heroCtaLabel') ? (
            <Link className="button button--light" href={hrefOf(range)}>
              {text(page, 'heroCtaLabel')}
            </Link>
          ) : null}
        </div>
      </section>

      <section className="split">
        <div>
          <SectionIntro eyebrow={text(page, 'styleEyebrow')} heading={text(page, 'styleHeading')} />
          <RichText value={richText(page, 'styleIntro')} className="prose" />
          <Figures value={blocks(page, 'stats')} />
        </div>
        <Picture media={image(page, 'styleImage')} className="split__image" />
      </section>

      {range ? (
        <section className="band">
          <SectionIntro eyebrow={text(page, 'rangeEyebrow')} heading={text(page, 'rangeHeading')} />
          <ul className="bottlings bottlings--brief">
            {bottlings.map((bottling) => (
              <BottlingCard key={bottling.id} bottling={bottling} />
            ))}
          </ul>
          {text(page, 'rangeCtaLabel') ? (
            <Link className="button" href={hrefOf(range)}>
              {text(page, 'rangeCtaLabel')}
            </Link>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
