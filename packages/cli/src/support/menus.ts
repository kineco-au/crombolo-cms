/**
 * A menu's items from the command line (story 361). The Menu element's `items`
 * tree is edited in place, so each item keeps its key and what a command does
 * not touch stays exactly as it was; the whole value is saved back to the draft.
 * An item is named by its labels from the top, `About/Our team`, as `menu show`
 * prints them, or by its key. docs/rendering.md, "Menus".
 */
import {
  BLOCK_LIST_EDITOR_ALIAS,
  type DocumentAggregate,
  keyFromReference,
  MENU_ALIAS_PROPERTY,
  normaliseUuid,
  SYSTEM_CONTENT_TYPE_KEYS,
} from '@crombolo/core'
import { looksLikeKey, NodeRepository } from '@crombolo/data'
import { menuByAlias, namedPath } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import {
  draftNote,
  type LibrarySite,
  libraryActor,
  libraryPathOf,
  refusedInLibrary,
} from './library.ts'
import type { Io } from './site.ts'

type Data = Record<string, unknown>
const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const BLOCK_LIST = BLOCK_LIST_EDITOR_ALIAS

/** What an item links to, as `menu show` says it. */
export interface MenuLink {
  kind: 'page' | 'media' | 'address'
  key: string | null
  /** The page's or media item's path, or the address. */
  to: string
}

export interface MenuEntry {
  /** The item's entry in its list's layout: its key and anything else kept there. */
  layout: Data
  /** The item's own values. */
  content: Data
  children: MenuList
  label: string
  link: MenuLink | null
  target: string | null
}

/** One level of the tree: its items, and the rest of the stored value, kept as it was. */
export interface MenuList {
  rest: Data
  entries: MenuEntry[]
}

export interface FoundMenu {
  key: string
  alias: string
  name: string
  /** `library:/Menus/Main` */
  path: string
  doc: DocumentAggregate
  items: MenuList
}

const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const valuesOf = (content: Data): Data[] =>
  Array.isArray(content.values) ? (content.values as Data[]) : []

const own = (content: Data, alias: string): unknown =>
  valuesOf(content).find((v) => v.alias === alias)?.value

/** The stored link as `menu show` says it, with the name a label falls back to. */
async function linkOf(
  site: LibrarySite,
  stored: unknown,
): Promise<{ link: MenuLink | null; name: string; target: string | null }> {
  const links = parsed(stored)
  const link = Array.isArray(links) ? (links[0] as Data | undefined) : undefined
  if (!isRecord(link)) return { link: null, name: '', target: null }
  const target = text(link.target) || null
  const key = keyFromReference(link.unique ?? link.udi)
  if (key) {
    const media = link.type === 'media'
    const node = await new NodeRepository(site.db).byKey(key)
    const path = await namedPath(site.db, key, media ? 'media' : 'content')
    return {
      link: { kind: media ? 'media' : 'page', key, to: path ? `/${path}` : '(no longer there)' },
      name: text(link.name) || node?.text || '',
      target,
    }
  }
  const url = text(link.url)
  return { link: { kind: 'address', key: null, to: url }, name: text(link.name) || url, target }
}

/** A stored list of menu items, read into the tree the commands edit. */
async function readList(site: LibrarySite, stored: unknown): Promise<MenuList> {
  const raw = parsed(stored)
  const rest = isRecord(raw) ? raw : {}
  const layouts = isRecord(rest.layout) ? rest.layout : {}
  const layout = Array.isArray(layouts[BLOCK_LIST]) ? (layouts[BLOCK_LIST] as Data[]) : []
  const contentData = Array.isArray(rest.contentData) ? (rest.contentData as Data[]) : []
  const entries: MenuEntry[] = []
  for (const item of layout) {
    const content = contentData.find((d) => d.key === item.contentKey)
    if (!content) continue
    const { link, name, target } = await linkOf(site, own(content, 'link'))
    entries.push({
      layout: item,
      content,
      children: await readList(site, own(content, 'children')),
      label: text(own(content, 'label')) || name || '(no label)',
      link,
      target,
    })
  }
  return { rest, entries }
}

/** The tree as the block list stores it; settings no item names any longer are left out. */
export function writeList(list: MenuList): Data {
  const layout = list.entries.map((entry) => entry.layout)
  const settingsKeys = new Set(layout.map((item) => item.settingsKey).filter(Boolean))
  const layouts = isRecord(list.rest.layout) ? list.rest.layout : {}
  const settings = Array.isArray(list.rest.settingsData) ? (list.rest.settingsData as Data[]) : []
  return {
    ...list.rest,
    layout: { ...layouts, [BLOCK_LIST]: layout },
    contentData: list.entries.map((entry) => {
      const children = writeList(entry.children)
      const values = valuesOf(entry.content)
      const at = values.findIndex((v) => v.alias === 'children')
      const next =
        at >= 0
          ? values.map((v, i) => (i === at ? { ...v, value: children } : v))
          : [...values, { alias: 'children', editorAlias: BLOCK_LIST, value: children }]
      return { ...entry.content, values: next }
    }),
    settingsData: settings.filter((d) => settingsKeys.has(d.key)),
  }
}

/** The menu a template names by `alias`: its draft, and its items as a tree. */
export async function findMenu(site: LibrarySite, alias: string): Promise<FoundMenu> {
  const key = await menuByAlias(site.db, alias)
  const doc = key ? await site.elements.byKey(key) : undefined
  if (!key || !doc)
    throw new CliError('not_found', `There is no menu "${alias}".`, {
      hint: '`crombolo content find --under library:/ --type menu` lists the menus.',
    })
  const node = await new NodeRepository(site.db).byKey(key)
  const stored = doc.values.find((v) => v.alias === 'items' && v.segment === null)?.value
  return {
    key,
    alias: text(doc.values.find((v) => v.alias === MENU_ALIAS_PROPERTY)?.value) || alias,
    name: doc.variants[0]?.name ?? alias,
    path: await libraryPathOf(site.db, node ?? null),
    doc,
    items: await readList(site, stored),
  }
}

export interface Located {
  list: MenuList
  entry: MenuEntry
  /** Its labels from the top: `About/Our team`. */
  path: string
}

/** Every item, depth first, with the list it is in and its label path. */
export function everyItem(list: MenuList, prefix = ''): Located[] {
  return list.entries.flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.label}` : entry.label
    return [{ list, entry, path }, ...everyItem(entry.children, path)]
  })
}

/** The item a reference names: its label path or its key; an ambiguous one refused. */
export function findItem(menu: FoundMenu, ref: string): Located {
  const all = everyItem(menu.items)
  const wanted = ref.trim()
  const byKey = looksLikeKey(wanted)
    ? all.filter(
        (item) =>
          typeof item.entry.layout.contentKey === 'string' &&
          normaliseUuid(item.entry.layout.contentKey) === normaliseUuid(wanted),
      )
    : []
  const path = wanted
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .toLowerCase()
  const found = byKey.length > 0 ? byKey : all.filter((item) => item.path.toLowerCase() === path)
  if (found.length === 0)
    throw new CliError('not_found', `The menu "${menu.alias}" has no item "${ref}".`, {
      hint: `\`crombolo content menu show ${menu.alias}\` lists its items.`,
    })
  if (found.length > 1)
    throw new CliError('refused', `More than one item in "${menu.alias}" is "${ref}".`, {
      hint: `\`crombolo content menu show ${menu.alias} -o json\` gives each one's key: name it by that.`,
    })
  return found[0] as Located
}

/** How many items an item is, with the ones below it. */
export const countOf = (entry: MenuEntry): number =>
  1 + entry.children.entries.reduce((sum, child) => sum + countOf(child), 0)

/** Whether `list` is the item's own list of children, or one below it. */
const isWithin = (entry: MenuEntry, list: MenuList): boolean =>
  entry.children === list || entry.children.entries.some((child) => isWithin(child, list))

export interface PlaceFlags {
  under?: string
  top?: boolean
  first?: boolean
  before?: string
  after?: string
}

/**
 * Puts an item in the tree where the flags say: under another, at the top,
 * first, or before or after another. With none, an item moved stays in its list
 * and one added goes last at the top. Answers the label path of where it went.
 */
export function placeItem(
  menu: FoundMenu,
  entry: MenuEntry,
  flags: PlaceFlags,
  moving?: Located,
): string | null {
  const places = [flags.first, flags.before, flags.after].filter(
    (f) => f !== undefined && f !== false,
  )
  if (places.length > 1) throw new CliError('usage', 'Say one of --first, --before or --after.')
  if (flags.under !== undefined && flags.top)
    throw new CliError('usage', 'Say one of --under or --top.')
  const sibling = flags.before ?? flags.after
  const parent = flags.under !== undefined ? findItem(menu, flags.under) : undefined
  const next = sibling !== undefined ? findItem(menu, sibling) : undefined
  if (moving && (parent?.entry === entry || next?.entry === entry))
    throw new CliError(
      'refused',
      'Nothing was changed: an item cannot go under, before or after itself.',
    )
  const list = parent
    ? parent.entry.children
    : flags.top
      ? menu.items
      : next
        ? next.list
        : (moving?.list ?? menu.items)
  if (next && next.list !== list)
    throw new CliError(
      'usage',
      `"${sibling}" is not ${parent ? `under "${parent.path}"` : 'at the top of the menu'}.`,
    )
  if (moving && isWithin(entry, list))
    throw new CliError('refused', 'Nothing was changed: an item cannot go under itself.')
  if (moving) moving.list.entries.splice(moving.list.entries.indexOf(entry), 1)
  const at = next
    ? list.entries.indexOf(next.entry) + (flags.after !== undefined ? 1 : 0)
    : flags.first
      ? 0
      : list.entries.length
  list.entries.splice(at, 0, entry)
  return parent ? parent.path : null
}

/** A new item: a link and its label, or a label alone, which makes a heading. */
export async function newItem(
  site: LibrarySite,
  menu: FoundMenu,
  link: string | undefined,
  label: string | undefined,
  target: string | undefined,
): Promise<MenuEntry> {
  if (link === undefined && !label?.trim())
    throw new CliError(
      'usage',
      'Say what the item links to, or give it a --label to make a heading.',
    )
  const type = await site.lookup.typeByKey('document', SYSTEM_CONTENT_TYPE_KEYS.MenuItem)
  if (!type) throw new CliError('not_found', 'This site has no menu item type.')
  const raw: Data = {
    link: link === undefined ? [] : [target ? { path: link, target } : link],
    label: label ?? '',
    children: [],
  }
  const converted = await site.writer.elementValues(type, raw, menu.key, 'items')
  if (!converted.ok) throw new CliError('refused', `Nothing was changed: ${converted.message}.`)
  const content = {
    key: crypto.randomUUID(),
    contentTypeKey: type.key,
    values: converted.value,
  }
  const shown = await linkOf(site, own(content, 'link'))
  return {
    layout: { contentKey: content.key },
    content,
    children: await readList(site, own(content, 'children')),
    label: label?.trim() || shown.name || '(no label)',
    link: shown.link,
    target: shown.target,
  }
}

/** The menu's draft saved with its items changed; with --publish, published too. */
export async function saveMenu(
  io: Io,
  site: LibrarySite,
  menu: FoundMenu,
  flags: { publish?: boolean; 'dry-run'?: boolean },
  said: string,
) {
  io.say(
    `  ${flags['dry-run'] ? 'would change' : 'changed'}  ${menu.name} (${menu.alias}): ${said}`,
  )
  if (flags['dry-run']) {
    io.say('\nNothing was changed (--dry-run).')
    return false
  }
  const { doc } = menu
  const values = doc.values
    .filter((v) => !(v.alias === 'items' && v.segment === null))
    .map(({ alias, culture, segment, value }) => ({ alias, culture, segment, value }))
  values.push({ alias: 'items', culture: null, segment: null, value: writeList(menu.items) })
  const input = {
    key: doc.key,
    contentTypeKey: doc.contentTypeKey,
    componentKey: null,
    parentKey: doc.parentKey,
    values,
    variants: doc.variants.map(({ culture, segment, name }) => ({ culture, segment, name })),
  }
  const saved = flags.publish
    ? await site.library.saveAndPublish(libraryActor(), doc.key, input, null)
    : await site.library.save(libraryActor(), doc.key, input)
  if (!saved.ok) throw refusedInLibrary(saved)
  io.say(flags.publish ? '  published' : draftNote(menu.path))
  return true
}

/** The tree as `-o json` gives it, with each item's key. */
export function itemsJson(list: MenuList): unknown[] {
  return list.entries.map((entry) => ({
    key:
      typeof entry.layout.contentKey === 'string' ? normaliseUuid(entry.layout.contentKey) : null,
    label: entry.label,
    link: entry.link,
    target: entry.target,
    items: itemsJson(entry.children),
  }))
}

/** The tree as text: each item's label and where it goes, the items below it indented. */
export function sayItems(io: Io, list: MenuList, depth = 1): void {
  for (const entry of list.entries) {
    const goes = entry.link ? `  → ${entry.link.to}` : '  (a heading)'
    io.say(`${'  '.repeat(depth)}${entry.label}${goes}${entry.target ? `  (${entry.target})` : ''}`)
    sayItems(io, entry.children, depth + 1)
  }
}

export const menuArgs = {
  alias: Args.string({ required: true, description: 'the menu, by the alias templates use' }),
}

export const placeFlags = {
  under: Flags.string({ summary: 'put it under this item', helpValue: '<item>' }),
  first: Flags.boolean({ summary: 'put it first in its list' }),
  before: Flags.string({ summary: 'put it before this item', helpValue: '<item>' }),
  after: Flags.string({ summary: 'put it after this item', helpValue: '<item>' }),
}

export const menuWriteFlags = {
  publish: Flags.boolean({
    summary: 'publish the menu too, so templates and the Delivery API follow',
  }),
  'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
}

export const menuWriteSpec = {
  effects: 'non_idempotent',
  cardinality: 'single',
  outputFields: [
    { name: 'key', type: 'string', description: 'the menu' },
    { name: 'alias', type: 'string' },
    { name: 'path', type: 'string' },
    { name: 'item', type: 'string', nullable: true, description: "the item's key" },
    { name: 'changed', type: 'boolean' },
    { name: 'published', type: 'boolean' },
  ],
  errors: ['not_found', 'usage', 'refused'],
} as const
