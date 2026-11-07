import type { BlockProps, Link } from '@crombolo/crombolo'

/** Words and an image, which swap sides from one row to the next in the stylesheet. */
export default async function FeatureRowBlock({ content }: BlockProps) {
  const image = (await content.media('image'))[0]
  const link = ((await content.value('link')) as Link[] | undefined)?.[0]
  return (
    <section class="feature-row wrap">
      <div>
        <h2>{content.text('heading')}</h2>
        <div class="prose">{content.html('text')}</div>
        {link ? <a href={link.url}>{link.name}</a> : null}
      </div>
      {image ? <img src={image.cropUrl({ width: 900, height: 620 })} alt={image.name} /> : null}
    </section>
  )
}
