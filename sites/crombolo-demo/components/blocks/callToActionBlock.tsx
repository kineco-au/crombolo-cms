import type { BlockProps, Link } from '@crombolo/crombolo'

export default async function CallToActionBlock({ content }: BlockProps) {
  const link = ((await content.value('link')) as Link[] | undefined)?.[0]
  return (
    <section class="call-to-action">
      <div class="wrap">
        <h2>{content.text('heading')}</h2>
        <p>{content.text('text')}</p>
        {link ? (
          <a class="button button--light" href={link.url}>
            {link.name}
          </a>
        ) : null}
      </div>
    </section>
  )
}
