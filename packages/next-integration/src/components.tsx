/** @jsxImportSource react */
/**
 * Server components for crombolo values (story 208): rich text, and block lists
 * and grids rendered through a component per element type.
 */
import {
  type ApiBlockGrid,
  type ApiBlockGridItem,
  type ApiBlockList,
  type ApiElement,
  decodeEntities,
  type RichTextGenericElement,
  type RichTextTags,
  type RichTextValue,
  walkRichText,
} from '@crombolo/delivery-client'
import { draftMode } from 'next/headers'
import Link from 'next/link'
import { type ComponentType, createElement, Fragment, type ReactNode } from 'react'

/** What a tag's component in `<RichText components>` is given. */
export interface RichTextTagProps<Node = RichTextGenericElement> {
  node: Node
  /** The element's attributes, ready to spread onto the tag. */
  props: Record<string, unknown>
  children?: ReactNode
}

/** A component per tag, in place of the tag itself; `a`, `img` and the block tags are typed. */
export type RichTextComponents = {
  [Tag in keyof RichTextTags]?: ComponentType<RichTextTagProps<RichTextTags[Tag]>>
} & { [tag: string]: ComponentType<RichTextTagProps<never>> | undefined }

const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'track', 'wbr'])
const REACT_NAMES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  tabindex: 'tabIndex',
  srcset: 'srcSet',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  allowfullscreen: 'allowFullScreen',
  frameborder: 'frameBorder',
  maxlength: 'maxLength',
  readonly: 'readOnly',
}
/** What the tree adds to describe a link or block, not attributes of the tag. */
const DESCRIBING = new Set(['destinationId', 'destinationType', 'linkType', 'route', 'content-id'])

function styleOf(css: string): Record<string, string> {
  const style: Record<string, string> = {}
  for (const rule of css.split(';')) {
    const colon = rule.indexOf(':')
    if (colon === -1) continue
    const name = rule.slice(0, colon).trim()
    const value = rule.slice(colon + 1).trim()
    if (!name || !value) continue
    const key = name.startsWith('--')
      ? name
      : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    style[key] = value
  }
  return style
}

/** A tree element's attributes as React props: decoded, renamed, and never a handler. */
function propsOf(node: RichTextGenericElement): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(node.attributes)) {
    if (DESCRIBING.has(name) || typeof value !== 'string' || /^on/i.test(name)) continue
    const text = decodeEntities(value)
    if (name === 'style') props.style = styleOf(text)
    else props[REACT_NAMES[name] ?? name] = text
  }
  return props
}

/** Where a link to a page goes in this app: its route, with any query or anchor. */
function routeHref(node: RichTextTags['a']): string | undefined {
  const route = node.attributes.route
  return route ? `${route.path}${route.queryString ?? ''}` : undefined
}

/**
 * Rich text, rendered from the Delivery API's tree (story 216): each tag as
 * itself or through `components`, a link to a page as a Next link, and each
 * block through the component for its element type in `blocks`.
 */
export function RichText({
  value,
  components = {},
  blocks = {},
  className,
}: {
  value: RichTextValue | null | undefined
  components?: RichTextComponents
  blocks?: BlockComponents
  className?: string
}) {
  if (!value?.elements.length) return null
  let key = 0
  const nodes = walkRichText<ReactNode>(value, {
    text: (node) => <Fragment key={key++}>{decodeEntities(node.text)}</Fragment>,
    block: (item) =>
      item ? (
        <Block key={key++} content={item.content} settings={item.settings} components={blocks} />
      ) : null,
    element: (node, children) => {
      const props = propsOf(node)
      const Own = components[node.tag] as ComponentType<RichTextTagProps> | undefined
      const inside = VOID.has(node.tag) || children.length === 0 ? undefined : children
      if (Own)
        return (
          <Own key={key++} node={node} props={props}>
            {inside}
          </Own>
        )
      const href = node.tag === 'a' ? routeHref(node as RichTextTags['a']) : undefined
      if (href)
        return (
          <Link key={key++} {...props} href={href}>
            {inside}
          </Link>
        )
      return createElement(node.tag, { ...props, key: key++ }, inside)
    },
  })
  return <div className={className}>{nodes}</div>
}

/** What a block's component is given. */
export interface BlockComponentProps<Content = ApiElement, Settings = ApiElement> {
  content: Content
  settings: Settings | null
}

export type BlockComponents = Record<string, ComponentType<BlockComponentProps<never, never>>>

async function Missing({ alias }: { alias: string }) {
  if (!(await draftMode()).isEnabled) return null
  return (
    <div data-crombolo-missing-block={alias} style={{ border: '1px dashed #c00', padding: '1rem' }}>
      There is no component for the block “{alias}” yet.
    </div>
  )
}

function Block({
  content,
  settings,
  components,
}: {
  content: ApiElement | null
  settings: ApiElement | null
  components: BlockComponents
}): ReactNode {
  if (!content) return null
  const Component = components[content.contentType] as
    | ComponentType<BlockComponentProps>
    | undefined
  return Component ? (
    <Component content={content} settings={settings} />
  ) : (
    <Missing alias={content.contentType} />
  )
}

/** A block list, each item through the component for its element type. */
export function BlockList({
  value,
  components,
}: {
  value: ApiBlockList | null | undefined
  components: BlockComponents
}) {
  if (!value?.items.length) return null
  return (
    <>
      {value.items.map((item, index) => (
        <Block
          key={item.content?.id ?? index}
          content={item.content}
          settings={item.settings}
          components={components}
        />
      ))}
    </>
  )
}

function GridItems({
  items,
  components,
}: {
  items: ApiBlockGridItem[]
  components: BlockComponents
}) {
  return (
    <>
      {items.map((item, index) => (
        <div
          key={item.content?.id ?? index}
          className="crombolo-grid-item"
          style={{ gridColumn: `span ${item.columnSpan}`, gridRow: `span ${item.rowSpan}` }}
        >
          <Block content={item.content} settings={item.settings} components={components} />
          {item.areas.map((area) => (
            <div
              key={area.alias}
              className="crombolo-grid-area"
              data-area={area.alias}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${item.areaGridColumns}, minmax(0, 1fr))`,
                gridColumn: `span ${area.columnSpan}`,
              }}
            >
              <GridItems items={area.items} components={components} />
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

/** A block grid, laid out in its columns, areas included. */
export function BlockGrid({
  value,
  components,
}: {
  value: ApiBlockGrid | null | undefined
  components: BlockComponents
}) {
  if (!value?.items.length) return null
  return (
    <div
      className="crombolo-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${value.gridColumns}, minmax(0, 1fr))`,
      }}
    >
      <GridItems items={value.items} components={components} />
    </div>
  )
}
