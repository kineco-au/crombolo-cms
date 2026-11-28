import type { BlockProps } from '@crombolo/crombolo'

export default function ExpandableBlock({ content }: BlockProps) {
  return (
    <details
      class={`prose-site mb-6 rounded border border-line bg-panel px-4 py-3 prose-pre:border-0 prose-pre:bg-paper prose-pre:text-xs [&_:not(pre)>code]:bg-paper`}
    >
      <summary class="cursor-pointer font-semibold">{content.text('title')}</summary>
      {content.html('body')}
    </details>
  )
}
