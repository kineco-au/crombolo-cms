import type { BlockProps } from '@crombolo/crombolo'

/**
 * A highlight block, as a row: a short word, then the line beside it. `<Blocks>`
 * renders every `highlight` block with this, wherever a page lists them; the
 * home page renders the same blocks as figures instead (`shared/highlights.tsx`).
 */
export default function HighlightBlock({ content }: BlockProps) {
  return (
    <li>
      <span class="highlight-rows__heading">{content.text('heading')}</span>
      <span>{content.text('detail')}</span>
    </li>
  )
}
