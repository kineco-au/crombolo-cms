import type { BlockProps } from '@crombolo/crombolo'
import { prose } from '../shared/styles.ts'

export default function ExpandableBlock({ content }: BlockProps) {
  return (
    <details
      class={`${prose} mb-6 rounded border border-line bg-panel px-4 py-3 prose-pre:border-0 prose-pre:bg-paper prose-pre:text-xs [&_:not(pre)>code]:bg-paper`}
    >
      <summary class="cursor-pointer font-semibold">{content.text('title')}</summary>
      {content.html('body')}
    </details>
  )
}
