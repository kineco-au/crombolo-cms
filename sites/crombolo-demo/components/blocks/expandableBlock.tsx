import type { BlockProps } from '@crombolo/crombolo'

export default function ExpandableBlock({ content }: BlockProps) {
  return (
    <details class="expandable prose">
      <summary>{content.text('title')}</summary>
      {content.html('body')}
    </details>
  )
}
