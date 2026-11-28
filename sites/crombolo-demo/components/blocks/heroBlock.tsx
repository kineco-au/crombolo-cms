import type { BlockProps, Link } from '@crombolo/crombolo'
import { buttons, wrap } from '../shared/styles.ts'

/** A photograph sits faded behind the words; artwork shows as it is, beside them where there is room and below where there is not. */
export default async function HeroBlock({ content }: BlockProps) {
  const image = (await content.media('image'))[0]
  const primary = ((await content.value('primaryLink')) as Link[] | undefined)?.[0]
  const secondary = ((await content.value('secondaryLink')) as Link[] | undefined)?.[0]
  const asItIs = Boolean(await content.value('imageAsItIs'))
  return (
    <section class="grid min-h-120 grid-cols-1 bg-green-deep text-white">
      {image ? (
        <img
          class={
            asItIs
              ? 'col-start-1 row-start-2 h-48 w-full object-cover object-right xl:row-start-1 xl:h-full'
              : 'col-start-1 row-start-1 size-full object-cover opacity-30'
          }
          src={image.cropUrl({ width: 1600, height: 800 })}
          alt=""
        />
      ) : null}
      <div
        class={`${wrap} z-10 col-start-1 row-start-1 self-center py-12 ${asItIs ? 'max-xl:pb-0' : ''}`}
      >
        <p class="mb-2 text-sm tracking-wider text-white/80 uppercase">{content.text('eyebrow')}</p>
        <h1
          class={`mb-4 font-serif text-4xl/tight font-bold text-balance md:text-5xl/tight lg:text-6xl/tight ${asItIs ? 'max-w-xl' : 'max-w-3xl'}`}
        >
          {content.text('heading')}
        </h1>
        <p class="max-w-xl text-xl/8 text-white/85">{content.text('text')}</p>
        <p class="mt-8 flex flex-wrap gap-3">
          {primary ? (
            <a class={buttons.light} href={primary.url}>
              {primary.name}
            </a>
          ) : null}
          {secondary ? (
            <a class={buttons.outline} href={secondary.url}>
              {secondary.name}
            </a>
          ) : null}
        </p>
      </div>
    </section>
  )
}
