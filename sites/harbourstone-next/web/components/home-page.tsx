import { RichText } from '@crombolo/next-integration/components'
import Link from 'next/link'
import { button, display, prose, shell } from '@/lib/classes'
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
      <section className="relative flex min-h-[88vh] items-end bg-sea pt-28 pb-16 text-foam after:absolute after:inset-0 after:bg-linear-to-t after:from-sea/90 after:via-sea/50 after:via-30% after:to-sea/10">
        <Picture
          media={image(page, 'heroImage')}
          className="absolute inset-0 size-full object-cover"
          sizes="100vw"
          priority
        />
        <div className={`${shell} relative z-10`}>
          <Eyebrow tone="light">{text(page, 'eyebrow')}</Eyebrow>
          <h1
            className={`${display} mt-4 text-5xl leading-none sm:text-7xl lg:text-8xl xl:text-9xl`}
          >
            {text(page, 'title')}
          </h1>
          <p className="mt-5 max-w-lg text-lg text-pretty">{text(page, 'strapline')}</p>
          {range && text(page, 'heroCtaLabel') ? (
            <Link className={`${button('light')} mt-8`} href={hrefOf(range)}>
              {text(page, 'heroCtaLabel')}
            </Link>
          ) : null}
        </div>
      </section>

      <section
        className={`${shell} grid items-center gap-10 py-20 md:grid-cols-2 md:gap-16 md:py-28`}
      >
        <div>
          <SectionIntro eyebrow={text(page, 'styleEyebrow')} heading={text(page, 'styleHeading')} />
          <RichText value={richText(page, 'styleIntro')} className={`${prose} mt-5`} />
          <Figures value={blocks(page, 'stats')} />
        </div>
        <Picture media={image(page, 'styleImage')} className="h-80 w-full object-cover md:h-112" />
      </section>

      {range ? (
        <section className="bg-foam py-20 md:py-28">
          <div className={shell}>
            <SectionIntro
              eyebrow={text(page, 'rangeEyebrow')}
              heading={text(page, 'rangeHeading')}
            />
            <ul className="mt-10 grid gap-5 md:grid-cols-2">
              {bottlings.map((bottling) => (
                <BottlingCard key={bottling.id} bottling={bottling} />
              ))}
            </ul>
            {text(page, 'rangeCtaLabel') ? (
              <Link className={`${button()} mt-10`} href={hrefOf(range)}>
                {text(page, 'rangeCtaLabel')}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  )
}
