import type { BlockProps, Link } from '@crombolo/crombolo'

export default async function HeroBlock({ content }: BlockProps) {
  const image = (await content.media('image'))[0]
  const primary = ((await content.value('primaryLink')) as Link[] | undefined)?.[0]
  const secondary = ((await content.value('secondaryLink')) as Link[] | undefined)?.[0]
  return (
    <section class="hero">
      {image ? <img src={image.cropUrl({ width: 1600, height: 800 })} alt="" /> : null}
      <div class="hero__text wrap">
        <p class="eyebrow">{content.text('eyebrow')}</p>
        <h1>{content.text('heading')}</h1>
        <p class="lead">{content.text('text')}</p>
        <p class="hero__actions">
          {primary ? (
            <a class="button" href={primary.url}>
              {primary.name}
            </a>
          ) : null}
          {secondary ? (
            <a class="button button--quiet" href={secondary.url}>
              {secondary.name}
            </a>
          ) : null}
        </p>
      </div>
    </section>
  )
}
