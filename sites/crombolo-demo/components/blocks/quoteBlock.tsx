import type { BlockProps } from '@crombolo/crombolo'
import { narrow } from '../shared/styles.ts'

export default function QuoteBlock({ content }: BlockProps) {
  return (
    <figure class={`${narrow} py-12 text-center`}>
      <blockquote class="font-serif text-2xl/snug text-balance italic md:text-3xl/snug">
        {content.text('quote')}
      </blockquote>
      <figcaption class="mt-4 text-muted">{content.text('attribution')}</figcaption>
    </figure>
  )
}
