import type { BlockProps, Link } from '@crombolo/crombolo'
import { buttons, wrap } from '../shared/styles.ts'

/** Last on a page, it meets the footer: `last:-mb-16` takes back the space `<main>` leaves. */
export default async function CallToActionBlock({ content }: BlockProps) {
  const link = ((await content.value('link')) as Link[] | undefined)?.[0]
  return (
    <section class="mt-12 bg-green py-14 text-center text-white last:-mb-16">
      <div class={wrap}>
        <h2 class="font-serif text-3xl font-bold text-balance">{content.text('heading')}</h2>
        <p class="mt-2 mb-6 text-lg text-white/85">{content.text('text')}</p>
        {link ? (
          <a class={buttons.light} href={link.url}>
            {link.name}
          </a>
        ) : null}
      </div>
    </section>
  )
}
