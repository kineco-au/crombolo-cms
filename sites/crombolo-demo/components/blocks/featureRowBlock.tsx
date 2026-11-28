import type { BlockProps, Link } from '@crombolo/crombolo'

/** Words and an image, which swap sides from one row to the next where there is room for both. */
export default async function FeatureRowBlock({ content }: BlockProps) {
  const image = (await content.media('image'))[0]
  const link = ((await content.value('link')) as Link[] | undefined)?.[0]
  return (
    <section
      class={`page-column grid grid-cols-1 items-center gap-8 py-12 md:grid-cols-2 md:gap-12 md:py-16 md:[&:nth-of-type(even)>img]:-order-1`}
    >
      <div>
        <h2 class="mb-3 font-serif text-3xl/tight font-bold text-balance">
          {content.text('heading')}
        </h2>
        <div class={`prose-site prose-lg`}>{content.html('text')}</div>
        {link ? (
          <a class="mt-2 inline-block font-medium text-green hover:text-terracotta" href={link.url}>
            {link.name}
          </a>
        ) : null}
      </div>
      {image ? (
        <img class="rounded" src={image.cropUrl({ width: 900, height: 620 })} alt={image.name} />
      ) : null}
    </section>
  )
}
