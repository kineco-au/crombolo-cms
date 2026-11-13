/**
 * Block values (story 345): the editors that store blocks, and the one reader of
 * their layout. Rendering, the Delivery API, content files, the CLI, search and
 * the alias check read blocks through it, so a block editor is added here once
 * rather than once in each of them.
 */
export const BLOCK_LIST_EDITOR_ALIAS = 'Umbraco.BlockList'
export const BLOCK_GRID_EDITOR_ALIAS = 'Umbraco.BlockGrid'
export const SINGLE_BLOCK_EDITOR_ALIAS = 'Umbraco.SingleBlock'
/** Rich text's, whose blocks are its value's `blocks`; `property-values.ts` names it too. */
const RICH_TEXT_EDITOR_ALIAS = 'Umbraco.RichText'

/** Editors whose stored value is a block value, its layout under the editor's alias. */
export const BLOCK_VALUE_EDITORS: ReadonlySet<string> = new Set([
  BLOCK_LIST_EDITOR_ALIAS,
  BLOCK_GRID_EDITOR_ALIAS,
  SINGLE_BLOCK_EDITOR_ALIAS,
])

/** Every editor whose value holds blocks: those, and rich text, whose blocks are its `blocks`. */
export const BLOCK_EDITORS: ReadonlySet<string> = new Set([
  ...BLOCK_VALUE_EDITORS,
  RICH_TEXT_EDITOR_ALIAS,
])

/** Editors that hold any number of blocks, in order; a Single Block holds one. */
export const BLOCK_LIST_EDITORS: ReadonlySet<string> = new Set([
  BLOCK_LIST_EDITOR_ALIAS,
  BLOCK_GRID_EDITOR_ALIAS,
])

export interface BlockData {
  key: string
  contentTypeKey: string
  values?: Array<{
    alias: string
    value: unknown
    editorAlias?: string
    culture?: string | null
    segment?: string | null
  }>
}

export interface BlockLayoutEntry {
  contentKey?: string
  settingsKey?: string | null
  /** The name it was given on its page (story 253). */
  alias?: unknown
  columnSpan?: number
  rowSpan?: number
  areas?: Array<{ key: string; items?: BlockLayoutEntry[] }>
}

export interface BlockValue {
  layout?: Record<string, BlockLayoutEntry[] | undefined>
  contentData?: BlockData[]
  settingsData?: BlockData[]
}

/** One block: its layout entry, its content and settings, and a grid block's areas. */
export interface Block {
  layout: BlockLayoutEntry
  content: BlockData | undefined
  settings: BlockData | undefined
  areas: Array<{ key: string; blocks: Block[] }>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Whether a value, parsed, has the shape of a block value. */
export function isBlockValue(value: unknown): value is BlockValue {
  const found = parsed(value)
  return isRecord(found) && isRecord(found.layout)
}

/**
 * The block value an editor's stored value holds: the value itself for a block
 * editor, rich text's `blocks`, or undefined. JSON text is parsed.
 */
export function blockValueOf(editorAlias: string, value: unknown): BlockValue | undefined {
  const found = parsed(value)
  if (!isRecord(found)) return undefined
  const block = editorAlias === RICH_TEXT_EDITOR_ALIAS ? parsed(found.blocks) : found
  return isBlockValue(block) ? (block as BlockValue) : undefined
}

/**
 * A block value's blocks under `layoutKey`, or under every key when none is
 * given, in order, each with its content and settings and a grid block's areas.
 * A layout entry whose content is missing is still listed, with none.
 */
export function readBlocks(value: unknown, layoutKey?: string): Block[] {
  const found = parsed(value)
  if (!isBlockValue(found)) return []
  const block = found as BlockValue
  const contents = new Map((block.contentData ?? []).map((d) => [d.key, d]))
  const settings = new Map((block.settingsData ?? []).map((d) => [d.key, d]))
  const build = (entries: unknown): Block[] =>
    (Array.isArray(entries) ? entries : []).filter(isRecord).map((entry) => {
      const layout = entry as BlockLayoutEntry
      return {
        layout,
        content: contents.get(layout.contentKey ?? ''),
        settings: settings.get(layout.settingsKey ?? ''),
        areas: (Array.isArray(layout.areas) ? layout.areas : [])
          .filter(isRecord)
          .map((area) => ({ key: String(area.key ?? ''), blocks: build(area.items) })),
      }
    })
  const layouts = block.layout ?? {}
  return layoutKey === undefined
    ? Object.values(layouts).flatMap((entries) => build(entries))
    : build(layouts[layoutKey])
}

/** Each list of blocks in a value: its own, and each grid area's, at any depth. */
export function blockLists(value: unknown, layoutKey?: string): Block[][] {
  const out: Block[][] = []
  const walk = (blocks: Block[]) => {
    out.push(blocks)
    for (const block of blocks) for (const area of block.areas) walk(area.blocks)
  }
  walk(readBlocks(value, layoutKey))
  return out
}

/**
 * Every block in a value, depth first: grid areas, and the blocks held in a
 * block's own content and settings values, such as a list within a block.
 */
export function everyBlock(value: unknown): Block[] {
  const out: Block[] = []
  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      out.push(block)
      visit(block.areas.flatMap((area) => area.blocks))
      for (const data of [block.content, block.settings])
        for (const own of data?.values ?? [])
          visit(readBlocks(blockValueOf(own.editorAlias ?? '', own.value)))
    }
  }
  visit(readBlocks(value))
  return out
}
