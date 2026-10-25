/**
 * Blocks render their own components (story 184). `<Blocks items={…} />` renders
 * each block of a Block List or Block Grid with `components/blocks/<element
 * alias>.tsx`, so a new kind of block is one new file, not an edit to every
 * template that lists blocks. A grid renders Umbraco's block-grid markup, so its
 * default stylesheet and CSS written for it apply unchanged.
 */
import { blockComponentLoader, isPreview } from './context.ts'
import { escapeHtml, RawHtml } from './html.ts'
import { type Child, renderToString } from './jsx-runtime.ts'
import type {
  BlockGridArea,
  BlockGridItem,
  BlockItem,
  PublishedElement,
  TypedElement,
} from './values.ts'

/** What a block's component is given. */
// biome-ignore lint/suspicious/noExplicitAny: an untyped block, as `TypedElement` defaults to.
export interface BlockProps<Content = any, Settings = any> {
  content: TypedElement<Content>
  settings: TypedElement<Settings> | null
  /** The block itself: its keys, and in a grid its spans and areas. */
  block: BlockItem | BlockGridItem
  /** In a grid, the block's areas, rendered: put `{children}` where they go. */
  children?: RawHtml
}

// biome-ignore lint/suspicious/noExplicitAny: a block component takes whichever props it declares.
type BlockComponent = (props: BlockProps<any, any>) => Child | Promise<Child>

export interface BlocksProps {
  /** A Block List or Block Grid property's value: `model.value('sections')`. */
  items: readonly BlockItem[] | null | undefined
  /** Components for some element types, in place of `components/blocks/`, here only. */
  components?: Readonly<Record<string, BlockComponent>>
  /** A grid's columns, when its value does not carry them; 12 otherwise. */
  columns?: number
}

const isGrid = (items: readonly BlockItem[]): items is readonly BlockGridItem[] =>
  items.some((item) => 'areas' in item && Array.isArray((item as BlockGridItem).areas))

const aliasOf = (element: PublishedElement) => element.contentType.alias ?? ''

const css = (vars: Record<string, number>) =>
  Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ')

/** Renders each block with its own component. */
export async function Blocks(props: BlocksProps): Promise<RawHtml> {
  const items = props.items ?? []
  if (items.length === 0) return new RawHtml('')
  if (!isGrid(items)) {
    const parts = await Promise.all(items.map((item) => renderBlock(item, props.components)))
    return new RawHtml(parts.join(''))
  }
  const columns = props.columns ?? (items as Partial<{ gridColumns: number }>).gridColumns ?? 12
  return new RawHtml(
    `<div class="umb-block-grid" data-grid-columns="${columns}" style="${css({ '--umb-block-grid--grid-columns': columns })}">${await layout(items, columns, props.components)}</div>`,
  )
}

/** One grid level: the container and its items, each with its areas. */
async function layout(
  items: readonly BlockGridItem[],
  columns: number,
  components: BlocksProps['components'],
): Promise<string> {
  const rendered = await Promise.all(
    items.map(async (item) => {
      const columnSpan = item.columnSpan ?? columns
      const rowSpan = item.rowSpan ?? 1
      const areaColumns = item.areaGridColumns ?? columns
      const areas =
        item.areas.length > 0
          ? `<div class="umb-block-grid__area-container" style="${css({ '--umb-block-grid--area-grid-columns': areaColumns })}">${(
              await Promise.all(item.areas.map((area) => areaHtml(area, areaColumns, components)))
            ).join('')}</div>`
          : ''
      const alias = escapeHtml(aliasOf(item.content))
      const inner = await renderBlock(item, components, areas ? new RawHtml(areas) : undefined)
      return `<div class="umb-block-grid__layout-item" data-content-element-type-alias="${alias}" data-content-element-type-key="${escapeHtml(item.content.contentType.key)}" data-element-key="${escapeHtml(item.contentKey)}" data-col-span="${columnSpan}" data-row-span="${rowSpan}" style="${css({ '--umb-block-grid--item-column-span': columnSpan, '--umb-block-grid--item-row-span': rowSpan })}">${inner}</div>`
    }),
  )
  return `<div class="umb-block-grid__layout-container">${rendered.join('')}</div>`
}

async function areaHtml(
  area: BlockGridArea,
  columns: number,
  components: BlocksProps['components'],
): Promise<string> {
  const columnSpan = area.columnSpan ?? columns
  const rowSpan = area.rowSpan ?? 1
  const alias = area.alias === null ? '' : ` data-area-alias="${escapeHtml(area.alias)}"`
  return `<div class="umb-block-grid__area"${alias} data-area-col-span="${columnSpan}" data-area-row-span="${rowSpan}" style="${css({ '--umb-block-grid--grid-columns': columnSpan, '--umb-block-grid--area-column-span': columnSpan, '--umb-block-grid--area-row-span': rowSpan })}">${await layout(area.items, columnSpan, components)}</div>`
}

/** A block through its component, or nothing (a placeholder in preview) when it has none. */
async function renderBlock(
  item: BlockItem,
  components: BlocksProps['components'],
  children?: RawHtml,
): Promise<string> {
  const alias = aliasOf(item.content)
  const component =
    (alias ? components?.[alias] : undefined) ??
    (alias ? await blockComponentLoader()?.(alias) : undefined)
  if (!component) {
    if (!isPreview()) return children?.value ?? ''
    const file = `components/blocks/${alias || '<element type>'}.tsx`
    return `<div class="crombolo-block-missing" style="padding: 12px; border: 1px dashed #b45309; color: #b45309; font: 14px sans-serif;">No component renders the “${escapeHtml(alias || 'unknown')}” block. Create <code>${escapeHtml(file)}</code>. Visitors see nothing here.</div>${children?.value ?? ''}`
  }
  const props: BlockProps = {
    content: item.content as BlockProps['content'],
    settings: item.settings as BlockProps['settings'],
    block: item,
    ...(children ? { children } : {}),
  }
  return renderToString((component as BlockComponent)(props) as Child)
}
