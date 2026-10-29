import type { ApiBlockList } from '@crombolo/next-integration'
import { type BlockComponentProps, BlockList } from '@crombolo/next-integration/components'
import { text } from '@/lib/content'

/** One highlight as a figure: its heading set large, a line under it. */
function Figure({ content }: BlockComponentProps) {
  return (
    <div>
      <dt>{text(content, 'heading')}</dt>
      <dd>{text(content, 'detail')}</dd>
    </div>
  )
}

/** One highlight as a row: a short word, then the line beside it. */
function Row({ content }: BlockComponentProps) {
  return (
    <li>
      <span className="highlight-rows__heading">{text(content, 'heading')}</span>
      <span>{text(content, 'detail')}</span>
    </li>
  )
}

/** The figures beside the house style: the same blocks as the rows, mapped to `Figure`. */
export function Figures({ value }: { value: ApiBlockList | undefined }) {
  if (!value?.items.length) return null
  return (
    <dl className="figures">
      <BlockList value={value} components={{ highlight: Figure }} />
    </dl>
  )
}

export function HighlightRows({ value }: { value: ApiBlockList | undefined }) {
  if (!value?.items.length) return null
  return (
    <ul className="highlight-rows">
      <BlockList value={value} components={{ highlight: Row }} />
    </ul>
  )
}
