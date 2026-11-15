import { blocks, childrenOf, hrefOf, image, type PageOf, richText, text } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { AppLink } from './app-link'
import { BottlingCard } from './bottling'
import { Figures } from './highlights'
import { Picture } from './picture'
import { RichText } from './rich-text'
import { Eyebrow, SectionIntro } from './section-intro'

/** The range is whichever child is the list, so renaming or moving it in the back office is followed. */
async function rangeOf(home: { id: string }) {
  const range = (await childrenOf(home)).find((child) => child.contentType === 'whiskyList')
  return { range, bottlings: range ? await childrenOf(range) : [] }
}

export function HomePage({ page }: { page: PageOf<'homePage'> }) {
  const loaded = useLoad(page.id, () => rangeOf(page))
  const range = loaded?.range
  return (
    <>
      <section className="hero">
        <Picture media={image(page, 'heroImage')} className="hero__image" sizes="100vw" priority />
        <div className="hero__text">
          <Eyebrow tone="light">{page.properties.eyebrow}</Eyebrow>
          <h1>{page.properties.title}</h1>
          <p className="strapline">{page.properties.strapline}</p>
          {range && page.properties.heroCtaLabel ? (
            <AppLink className="button button--light" href={hrefOf(range)}>
              {page.properties.heroCtaLabel}
            </AppLink>
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
            {loaded.bottlings.map((bottling) => (
              <BottlingCard key={bottling.id} bottling={bottling} />
            ))}
          </ul>
          {page.properties.rangeCtaLabel ? (
            <AppLink className="button" href={hrefOf(range)}>
              {page.properties.rangeCtaLabel}
            </AppLink>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
