import { type BlockItem, type BlockProps, Blocks } from '@crombolo/crombolo'

/** A page's highlight blocks; a block list is always a list, empty when there are none. */
export function highlightsOf(value: unknown): BlockItem[] {
  return (value ?? []) as BlockItem[]
}

/** One highlight as a figure: its heading set large, a line under it. */
function Figure({ content }: BlockProps) {
  return (
    <div>
      <dt>{content.text('heading')}</dt>
      <dd>{content.text('detail')}</dd>
    </div>
  )
}

/**
 * The figures beside the house style: the same `highlight` blocks the About page
 * lists as rows, rendered here as figures by mapping the type to `Figure`.
 */
export function Figures({ items }: { items: BlockItem[] }) {
  if (items.length === 0) return null
  return (
    <dl class="figures">
      <Blocks items={items} components={{ highlight: Figure }} />
    </dl>
  )
}

/** Highlights as a divided list, each block through `components/blocks/highlight.tsx`. */
export function HighlightRows({ items }: { items: BlockItem[] }) {
  if (items.length === 0) return null
  return (
    <ul class="highlight-rows">
      <Blocks items={items} />
    </ul>
  )
}
