import type { BlockProps } from '@crombolo/crombolo'

export default function QuoteBlock({ content }: BlockProps) {
  return (
    <figure class="quote wrap wrap--narrow">
      <blockquote>{content.text('quote')}</blockquote>
      <figcaption>{content.text('attribution')}</figcaption>
    </figure>
  )
}
