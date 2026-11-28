import type { BlockProps } from '@crombolo/crombolo'

/**
 * A highlight block, as a row: a short word, then the line beside it. `<Blocks>`
 * renders every `highlight` block with this, wherever a page lists them; the
 * home page renders the same blocks as figures instead (`shared/highlights.tsx`).
 */
export default function HighlightBlock({ content }: BlockProps) {
  return (
    <li class="grid gap-1 border-t border-foam/15 py-4 text-foam/80 first:border-t-0">
      <span class="font-display text-xl text-foam">{content.text('heading')}</span>
      <span>{content.text('detail')}</span>
    </li>
  )
}
