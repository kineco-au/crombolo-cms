import type { ApiBlockList } from '@crombolo/delivery-client'
import { text } from '@/lib/content'

const highlightsIn = (value: ApiBlockList | undefined) =>
  (value?.items ?? []).flatMap((item) =>
    item.content?.contentType === 'highlight' ? [item.content] : [],
  )

/** The figures beside the house style: each highlight's heading set large, a line under it. */
export function Figures({ value }: { value: ApiBlockList | undefined }) {
  const items = highlightsIn(value)
  if (items.length === 0) return null
  return (
    <dl className="mt-10 grid grid-cols-2 gap-6 border-t border-line pt-6">
      {items.map((item) => (
        <div key={item.id}>
          <dt className="font-display text-3xl">{text(item, 'heading')}</dt>
          <dd className="mt-1 text-sm text-muted">{text(item, 'detail')}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The same blocks as rows: a short word, then the line beside it. */
export function HighlightRows({ value }: { value: ApiBlockList | undefined }) {
  const items = highlightsIn(value)
  if (items.length === 0) return null
  return (
    <ul className="mt-8 divide-y divide-foam/15">
      {items.map((item) => (
        <li key={item.id} className="grid gap-1 py-4 text-foam/80 first:pt-0">
          <span className="font-display text-xl text-foam">{text(item, 'heading')}</span>
          <span>{text(item, 'detail')}</span>
        </li>
      ))}
    </ul>
  )
}
