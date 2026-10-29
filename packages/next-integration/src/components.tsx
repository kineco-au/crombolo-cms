/** @jsxImportSource react */
/**
 * Server components for crombolo values (story 208): rich text, and block lists
 * and grids rendered through a component per element type.
 */
import type {
  ApiBlockGrid,
  ApiBlockGridItem,
  ApiBlockList,
  ApiElement,
  ApiRichText,
} from '@crombolo/delivery-client'
import { draftMode } from 'next/headers'
import type { ComponentType, ReactNode } from 'react'
import { RichTextLinks } from './client.tsx'

/**
 * Rich text as the CMS wrote it, with links to its pages navigating in the app.
 * The markup is the CMS's own, already sanitised there.
 */
export function RichText({
  value,
  className,
}: {
  value: ApiRichText | null | undefined
  className?: string
}) {
  if (!value?.markup) return null
  return (
    <RichTextLinks className={className}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the CMS's own sanitised markup. */}
      <div dangerouslySetInnerHTML={{ __html: value.markup }} />
    </RichTextLinks>
  )
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
