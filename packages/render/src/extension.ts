/**
 * `<Extension use="brochures/card" … />`: an extension's component in a site's
 * page (story 312). It renders in the extension's own process, given the page's
 * props and these, and its HTML goes here. Children render here first and go as
 * HTML. Nothing renders where no extension offers it, or where it is not granted
 * `templates`, and the site's log says why. docs/writing-components.md.
 */
import { currentExtensionComponent, usePage } from './context.ts'
import { RawHtml } from './html.ts'
import { type Child, renderToString } from './jsx-runtime.ts'

export interface ExtensionProps {
  /** `<extension id>/<component>`. */
  use: string
  children?: Child
  [prop: string]: unknown
}

export async function Extension({ use, children, ...props }: ExtensionProps): Promise<RawHtml> {
  const render = currentExtensionComponent()?.(use)
  if (!render) return new RawHtml('')
  const inner = children === undefined ? undefined : new RawHtml(await renderToString(children))
  const rendered = await render({
    ...usePage(),
    ...props,
    ...(inner ? { children: inner } : {}),
  })
  return rendered instanceof RawHtml ? rendered : new RawHtml(await renderToString(rendered))
}
