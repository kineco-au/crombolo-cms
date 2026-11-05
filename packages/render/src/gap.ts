/**
 * A marked gap in a template (story 281): where a part could not be carried over,
 * visitors see the rest of the page and an editor's preview says what is missing.
 */
import { isPreview } from './context.ts'
import { escapeHtml, RawHtml } from './html.ts'
import { type Child, renderToString } from './jsx-runtime.ts'

export interface GapProps {
  /** Why this part is missing. */
  reason: string
  /** What used to be here. */
  was?: string
  /** What visitors see in its place, if anything. */
  children?: Child
}

// A span, so a gap inside a paragraph does not close the paragraph.
const BOX =
  'display: block; box-sizing: border-box; min-height: 96px; padding: 12px; background: #e5e7eb; border: 1px dashed #6b7280; color: #374151; font: 14px sans-serif;'

/** Its children or nothing to visitors; in preview, a box saying what is missing. */
export async function Gap(props: GapProps): Promise<RawHtml> {
  const children = await renderToString(props.children)
  if (!isPreview()) return new RawHtml(children)
  const was = props.was ? `<span style="display: block;">Was: ${escapeHtml(props.was)}</span>` : ''
  return new RawHtml(
    `<span class="crombolo-gap" style="${BOX}"><span style="display: block;"><strong>Missing:</strong> ${escapeHtml(props.reason)}</span>${was}<span style="display: block;">Visitors don't see this box.</span>${children}</span>`,
  )
}
