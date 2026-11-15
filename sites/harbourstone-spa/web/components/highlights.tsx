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
    <dl className="figures">
      {items.map((item) => (
        <div key={item.id}>
          <dt>{text(item, 'heading')}</dt>
          <dd>{text(item, 'detail')}</dd>
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
    <ul className="highlight-rows">
      {items.map((item) => (
        <li key={item.id}>
          <span className="highlight-rows__heading">{text(item, 'heading')}</span>
          <span>{text(item, 'detail')}</span>
        </li>
      ))}
    </ul>
  )
}
