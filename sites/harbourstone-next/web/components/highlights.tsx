import type { ApiBlockList } from '@crombolo/next-integration'
import { type BlockComponentProps, BlockList } from '@crombolo/next-integration/components'
import { text } from '@/lib/content'

/** One highlight as a figure: its heading set large, a line under it. */
function Figure({ content }: BlockComponentProps) {
  return (
    <div>
      <dt className="font-display text-3xl">{text(content, 'heading')}</dt>
      <dd className="mt-1 text-sm text-muted">{text(content, 'detail')}</dd>
    </div>
  )
}

/** One highlight as a row: a short word, then the line beside it. */
function Row({ content }: BlockComponentProps) {
  return (
    <li className="grid gap-1 py-4 text-foam/80 first:pt-0">
      <span className="font-display text-xl text-foam">{text(content, 'heading')}</span>
      <span>{text(content, 'detail')}</span>
    </li>
  )
}

/** The figures beside the house style: the same blocks as the rows, mapped to `Figure`. */
export function Figures({ value }: { value: ApiBlockList | undefined }) {
  if (!value?.items.length) return null
  return (
    <dl className="mt-10 grid grid-cols-2 gap-6 border-t border-line pt-6">
      <BlockList value={value} components={{ highlight: Figure }} />
    </dl>
  )
}

export function HighlightRows({ value }: { value: ApiBlockList | undefined }) {
  if (!value?.items.length) return null
  return (
    <ul className="mt-8 divide-y divide-foam/15">
      <BlockList value={value} components={{ highlight: Row }} />
    </ul>
  )
}
