import {
  decodeEntities,
  type RichTextAttributes,
  type RichTextValue,
  walkRichText,
} from '@crombolo/delivery-client'
import { createElement, Fragment, type ReactNode } from 'react'
import { mediaUrl } from '@/lib/address'
import { AppLink } from './app-link'

const VOID = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'source', 'track', 'wbr'])
const RENAMED: Record<string, string> = {
  class: 'className',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  tabindex: 'tabIndex',
}

/** The attributes a tag can carry into React: plain HTML ones, never a handler or a style. */
function htmlAttributes(attributes: RichTextAttributes): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name.startsWith('on') || name === 'style') continue
    out[RENAMED[name] ?? name] = decodeEntities(String(value))
  }
  return out
}

/** Rich text from the CMS: each tag as itself, a link to a page followed in the app. */
export function RichText({
  value,
  className,
}: {
  value: RichTextValue | undefined
  className?: string
}) {
  if (!value) return null
  const nodes = walkRichText<ReactNode>(value, {
    text: (node) => decodeEntities(node.text),
    element: (node, children) =>
      VOID.has(node.tag)
        ? createElement(node.tag, htmlAttributes(node.attributes))
        : createElement(node.tag, htmlAttributes(node.attributes), ...children),
    block: () => null,
    tags: {
      a: (node, children) => {
        const { route, href, ...rest } = node.attributes
        return route
          ? createElement(AppLink, { ...htmlAttributes(rest), href: route.path }, ...children)
          : createElement('a', { ...htmlAttributes(rest), href }, ...children)
      },
      img: (node) =>
        createElement('img', {
          ...htmlAttributes(node.attributes),
          src: mediaUrl(node.attributes.src ?? ''),
          alt: decodeEntities(node.attributes.alt ?? ''),
        }),
    },
  })
  return <div className={className}>{createElement(Fragment, null, ...nodes)}</div>
}
