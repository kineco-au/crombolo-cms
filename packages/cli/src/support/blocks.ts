/**
 * A page's blocks changed from the command line (story 253): the stored block
 * value edited in place, so what a command does not touch stays exactly as it
 * was. A block is named by its alias or its key. A block list, and a block
 * grid's top level; a grid's areas and blocks inside a block are not reached.
 */
import type { ContentTypeAggregate, DocumentValue } from '@crombolo/core'
import { normaliseUuid } from '@crombolo/core'
import { BLOCK_ALIAS } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import {
  type FoundPage,
  findPage,
  type PageSite,
  pageFlags,
  savePage,
  setsOf,
  typedValue,
  withPages,
} from './pages.ts'
import type { Io } from './site.ts'

type Data = Record<string, unknown>
const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const LIST_EDITORS = new Set(['Umbraco.BlockList', 'Umbraco.BlockGrid'])

export interface BlockList {
  page: FoundPage
  property: string
  editor: string
  culture: string | null
  value: { layout: Data; contentData: Data[]; settingsData: Data[] }
  /** The list's own entries, in order. */
  layout: Data[]
  /** What the data type offers: each block's element type and its settings type. */
  offered: Array<{ content: string; settings: string | null }>
}

/** A page's block list or grid, by its property's alias, as it is stored. */
export async function blockListOf(
  site: PageSite,
  ref: string,
  property: string,
  culture: string | null,
): Promise<BlockList> {
  const page = await findPage(site, ref)
  const editor = page.editors.get(property)
  if (!editor)
    throw new CliError('not_found', `"${page.type.alias}" has no property "${property}".`, {
      hint: `\`crombolo types show ${page.type.alias}\` lists its properties.`,
    })
  if (!LIST_EDITORS.has(editor.editor))
    throw new CliError('refused', `"${property}" is not a block list or grid.`)
  const at = editor.variesByCulture ? (culture ?? site.languages[0] ?? null) : null
  const stored = page.doc.values.find(
    (v) => v.alias === property && v.culture === at && v.segment === null,
  )?.value
  const raw = isRecord(stored) ? stored : {}
  const layoutAlias = editor.editor
  const layouts = isRecord(raw.layout) ? raw.layout : {}
  const layout = Array.isArray(layouts[layoutAlias]) ? (layouts[layoutAlias] as Data[]) : []
  const blocks = Array.isArray(editor.config.blocks) ? (editor.config.blocks as Data[]) : []
  return {
    page,
    property,
    editor: editor.editor,
    culture: at,
    value: {
      layout: { ...layouts, [layoutAlias]: layout },
      contentData: Array.isArray(raw.contentData) ? (raw.contentData as Data[]) : [],
      settingsData: Array.isArray(raw.settingsData) ? (raw.settingsData as Data[]) : [],
    },
    layout,
    offered: blocks.flatMap((b) =>
      typeof b.contentElementTypeKey === 'string'
        ? [
            {
              content: normaliseUuid(b.contentElementTypeKey),
              settings:
                typeof b.settingsElementTypeKey === 'string'
                  ? normaliseUuid(b.settingsElementTypeKey)
                  : null,
            },
          ]
        : [],
    ),
  }
}

/** Where in the list a block an alias or key names is; refused, listing them, when none is. */
export function indexOfBlock(list: BlockList, ref: string): number {
  const wanted = ref.toLowerCase()
  const index = list.layout.findIndex(
    (item) =>
      (typeof item.alias === 'string' && item.alias.toLowerCase() === wanted) ||
      (typeof item.contentKey === 'string' && item.contentKey.toLowerCase() === wanted),
  )
  if (index < 0)
    throw new CliError('not_found', `"${list.property}" has no block "${ref}".`, {
      hint: `\`crombolo content show ${list.page.path}\` lists its blocks, with their aliases and keys.`,
    })
  return index
}

/** An alias for a block, checked against the list's others; "" for none. */
export function checkedAlias(list: BlockList, alias: string, except?: number): string | undefined {
  if (alias === '') return undefined
  if (!BLOCK_ALIAS.test(alias))
    throw new CliError(
      'usage',
      `"${alias}" is not a block alias: letters, digits, - and _, starting with a letter.`,
    )
  if (
    list.layout.some(
      (item, i) =>
        i !== except &&
        typeof item.alias === 'string' &&
        item.alias.toLowerCase() === alias.toLowerCase(),
    )
  )
    throw new CliError('refused', `Nothing was changed: another block here is called "${alias}".`)
  return alias
}

/** An element's values from `--set`, each read by its property's editor. */
export async function elementValuesOf(
  site: PageSite,
  element: ContentTypeAggregate,
  sets: ReadonlyArray<[string, string]>,
  owner: string,
): Promise<Array<{ alias: string; value: unknown }>> {
  const editors = await site.lookup.editorsOf('document', element)
  const raw: Data = {}
  for (const [alias, text] of sets) {
    const property = editors.get(alias)
    if (!property)
      throw new CliError(
        'refused',
        `Nothing was changed: "${element.alias}" has no property "${alias}".`,
      )
    raw[alias] = typedValue(property.editor, text)
  }
  const converted = await site.writer.elementValues(element, raw, owner, element.alias)
  if (!converted.ok) throw new CliError('refused', `Nothing was changed: ${converted.message}.`)
  return converted.value as Array<{ alias: string; value: unknown }>
}

/** Values merged into a block's own: each set replaces its alias's, each unset is taken away. */
export function mergedValues(
  existing: unknown,
  set: ReadonlyArray<{ alias: string; value: unknown }>,
  unset: readonly string[] = [],
): Data[] {
  const out = (Array.isArray(existing) ? (existing as Data[]) : []).filter(
    (v) => !unset.includes(String(v.alias)) && !set.some((s) => s.alias === v.alias),
  )
  return [...out, ...set]
}

/** The list saved back into the page's values, and the page saved as a draft. */
export async function saveBlockList(
  io: Io,
  site: PageSite,
  list: BlockList,
  flags: { publish?: boolean; 'skip-approval'?: boolean; 'dry-run'?: boolean },
  said: string,
) {
  io.say(
    `  ${flags['dry-run'] ? 'would change' : 'changed'}  ${list.page.path}  ${list.property}: ${said}`,
  )
  if (flags['dry-run']) {
    io.say('\nNothing was changed (--dry-run).')
    return { key: list.page.doc.key, path: list.page.path, changed: false }
  }
  const { doc } = list.page
  const value = {
    ...list.value,
    layout: { ...list.value.layout, [list.editor]: list.layout },
  }
  const values: DocumentValue[] = doc.values
    .filter((v) => !(v.alias === list.property && v.culture === list.culture && v.segment === null))
    .map(({ alias, culture, segment, value }) => ({ alias, culture, segment, value }))
  values.push({ alias: list.property, culture: list.culture, segment: null, value })
  await savePage(
    io,
    site,
    doc.key,
    {
      key: doc.key,
      contentTypeKey: doc.contentTypeKey,
      componentKey: doc.componentKey,
      parentKey: doc.parentKey,
      values,
      variants: doc.variants.map(({ culture, segment, name }) => ({ culture, segment, name })),
    },
    flags,
  )
  return { key: doc.key, path: list.page.path, changed: true }
}

/** Where a block goes in its list: before or after another, first or last. */
export function placeIn(list: BlockList, flags: PlaceFlags, moving?: number): number {
  const length = list.layout.length - (moving === undefined ? 0 : 1)
  if (flags.first) return 0
  if (flags.before || flags.after) {
    const other = indexOfBlock(list, (flags.before ?? flags.after) as string)
    if (other === moving)
      throw new CliError('usage', 'A block cannot be placed before or after itself.')
    const at = moving !== undefined && other > moving ? other - 1 : other
    return flags.before ? at : at + 1
  }
  return length
}

export interface PlaceFlags {
  before?: string
  after?: string
  first?: boolean
  last?: boolean
}

export const placeFlags = {
  before: Flags.string({ summary: 'put it before this block', helpValue: '<alias|key>' }),
  after: Flags.string({ summary: 'put it after this block', helpValue: '<alias|key>' }),
  first: Flags.boolean({ summary: 'put it first' }),
  last: Flags.boolean({ summary: 'put it last' }),
}

/** The flags every block command takes. */
export const blockFlags = {
  culture: pageFlags.culture,
  publish: pageFlags.publish,
  'skip-approval': pageFlags['skip-approval'],
  'dry-run': pageFlags['dry-run'],
}

export const blockArgs = {
  page: Args.string({ required: true, description: 'the page: a path or a uuid' }),
  property: Args.string({ required: true, description: 'its block list or grid property' }),
}

export const blockSpec = {
  effects: 'idempotent',
  cardinality: 'single',
  outputFields: [
    { name: 'key', type: 'string' },
    { name: 'path', type: 'string' },
    { name: 'changed', type: 'boolean' },
  ],
  errors: ['not_found', 'usage', 'refused'],
} as const

export { setsOf, withPages }
