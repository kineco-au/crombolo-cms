import type { BlockProps } from '@crombolo/crombolo'

export default function TextBlock({ content }: BlockProps) {
  return <div class="prose-site">{content.html('body')}</div>
}
