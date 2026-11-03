/**
 * Changes to a content, element, media or member type (story 248), and to a
 * data type (story 249): settings, tabs, properties, blocks, each a pure function to
 * the changed type, or the reason it cannot change. Whether the change is safe
 * for the site's content is the check's to say, not these.
 */
import {
  allProperties,
  type SchemaContentType,
  type SchemaDataType,
  type SchemaProperty,
  type SchemaTab,
} from './model.ts'
import { DATA_TYPE_PRESETS, optionFlag, type PresetOptions } from './presets.ts'
import { addProperty } from './scaffold.ts'

export { addProperty }

export type EditResult = { ok: true; type: SchemaContentType } | { ok: false; reason: string }

const refuse = (reason: string): EditResult => ({ ok: false, reason })

export interface TypeChanges {
  name?: string
  description?: string
  icon?: string
  allowAtRoot?: boolean
  isElement?: boolean
  allowInLibrary?: boolean
  variesByCulture?: boolean
  variesBySegment?: boolean
  /** The list view its children are shown in, or null for none. */
  listView?: string | null
  allowChild?: readonly string[]
  disallowChild?: readonly string[]
  compose?: readonly string[]
  decompose?: readonly string[]
  view?: readonly string[]
  removeView?: readonly string[]
  defaultView?: string
}

const added = (list: readonly string[], more: readonly string[] = []) => [
  ...list,
  ...more.filter((item) => !list.includes(item)),
]
const without = (list: readonly string[], less: readonly string[] = []) =>
  list.filter((item) => !less.includes(item))

/** A type's own settings, its allowed children, compositions and views. */
export function updateType(type: SchemaContentType, changes: TypeChanges): EditResult {
  for (const alias of changes.compose ?? [])
    if (alias === type.alias) return refuse(`"${type.alias}" cannot be composed of itself`)
  for (const alias of changes.decompose ?? [])
    if (!type.compositions.includes(alias))
      return refuse(`"${type.alias}" is not composed of "${alias}"`)
  for (const alias of changes.disallowChild ?? [])
    if (!type.allowChildren.includes(alias))
      return refuse(`"${type.alias}" does not allow "${alias}" beneath it`)
  for (const view of changes.removeView ?? [])
    if (!type.components.includes(view)) return refuse(`"${type.alias}" has no view "${view}"`)
  const components = without(added(type.components, changes.view), changes.removeView)
  const defaultView = changes.defaultView ?? type.defaultComponent
  if (changes.defaultView && !components.includes(changes.defaultView))
    return refuse(`"${changes.defaultView}" is not one of "${type.alias}"'s views`)
  const next: SchemaContentType = {
    ...type,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.description !== undefined ? { description: changes.description || undefined } : {}),
    ...(changes.icon !== undefined ? { icon: changes.icon } : {}),
    ...(changes.allowAtRoot !== undefined ? { allowAtRoot: changes.allowAtRoot } : {}),
    ...(changes.isElement !== undefined ? { isElement: changes.isElement } : {}),
    ...(changes.allowInLibrary !== undefined ? { allowInLibrary: changes.allowInLibrary } : {}),
    ...(changes.variesByCulture !== undefined ? { variesByCulture: changes.variesByCulture } : {}),
    ...(changes.variesBySegment !== undefined ? { variesBySegment: changes.variesBySegment } : {}),
    ...(changes.listView !== undefined ? { collection: changes.listView ?? undefined } : {}),
    allowChildren: without(added(type.allowChildren, changes.allowChild), changes.disallowChild),
    compositions: without(added(type.compositions, changes.compose), changes.decompose),
    components,
    defaultComponent: defaultView && components.includes(defaultView) ? defaultView : components[0],
  }
  return { ok: true, type: next }
}

/** Where a tab goes among the others: before or after one, or last. */
export interface Placement {
  before?: string
  after?: string
}

function place<T>(
  list: readonly T[],
  item: T,
  at: Placement,
  nameOf: (x: T) => string,
): T[] | string {
  const anchor = at.before ?? at.after
  if (!anchor) return [...list, item]
  const index = list.findIndex((x) => nameOf(x).toLowerCase() === anchor.toLowerCase())
  if (index < 0) return `there is no "${anchor}" to put it ${at.before ? 'before' : 'after'}`
  const out = [...list]
  out.splice(at.before ? index : index + 1, 0, item)
  return out
}

const tabNamed = (type: SchemaContentType, name: string) =>
  type.tabs.find((tab) => tab.name.toLowerCase() === name.toLowerCase())

export function addTab(type: SchemaContentType, name: string, at: Placement = {}): EditResult {
  if (tabNamed(type, name)) return refuse(`"${type.alias}" already has a tab "${name}"`)
  const tabs = place(type.tabs, { name, properties: [], groups: [] }, at, (t) => t.name)
  return typeof tabs === 'string' ? refuse(tabs) : { ok: true, type: { ...type, tabs } }
}

export function renameTab(type: SchemaContentType, name: string, to: string): EditResult {
  const tab = tabNamed(type, name)
  if (!tab) return refuse(`"${type.alias}" has no tab "${name}"`)
  if (to.toLowerCase() !== name.toLowerCase() && tabNamed(type, to))
    return refuse(`"${type.alias}" already has a tab "${to}"`)
  return {
    ok: true,
    type: { ...type, tabs: type.tabs.map((t) => (t === tab ? { ...t, name: to } : t)) },
  }
}

export function moveTab(type: SchemaContentType, name: string, at: Placement): EditResult {
  const tab = tabNamed(type, name)
  if (!tab) return refuse(`"${type.alias}" has no tab "${name}"`)
  if (!at.before && !at.after) return refuse('say where: before or after another tab')
  const tabs = place(
    type.tabs.filter((t) => t !== tab),
    tab,
    at,
    (t) => t.name,
  )
  return typeof tabs === 'string' ? refuse(tabs) : { ok: true, type: { ...type, tabs } }
}

const propertiesIn = (tab: SchemaTab) => [
  ...tab.properties,
  ...tab.groups.flatMap((group) => group.properties),
]

/** A tab taken out; its properties moved to another, or refused while it has any. */
export function removeTab(type: SchemaContentType, name: string, moveTo?: string): EditResult {
  const tab = tabNamed(type, name)
  if (!tab) return refuse(`"${type.alias}" has no tab "${name}"`)
  const held = propertiesIn(tab)
  if (held.length > 0 && !moveTo)
    return refuse(
      `the tab "${tab.name}" holds ${held.length} propert${held.length === 1 ? 'y' : 'ies'} (${held.map((p) => p.alias).join(', ')}); move them to another tab first, or name one to move them to`,
    )
  if (moveTo && !tabNamed(type, moveTo)) return refuse(`"${type.alias}" has no tab "${moveTo}"`)
  if (moveTo && tabNamed(type, moveTo) === tab)
    return refuse('a tab cannot take its own properties')
  const target = moveTo ? tabNamed(type, moveTo) : undefined
  const tabs = type.tabs
    .filter((t) => t !== tab)
    .map((t) => (t === target ? { ...t, properties: [...t.properties, ...held] } : t))
  return { ok: true, type: { ...type, tabs } }
}

export interface PropertyChanges {
  name?: string
  description?: string
  mandatory?: boolean
  regex?: string | null
  regexMessage?: string | null
  variesByCulture?: boolean
  variesBySegment?: boolean
  /** Its data type's alias. */
  dataType?: string
  memberCanView?: boolean
  memberCanEdit?: boolean
  sensitive?: boolean
}

/** Every property of the type changed by `change` where `alias` matches; the rest as they are. */
function mapProperties(
  type: SchemaContentType,
  change: (p: SchemaProperty) => SchemaProperty | undefined,
): SchemaContentType {
  const each = (list: readonly SchemaProperty[]) =>
    list.flatMap((p) => {
      const next = change(p)
      return next ? [next] : []
    })
  return {
    ...type,
    properties: each(type.properties),
    groups: (type.groups ?? []).map((g) => ({ ...g, properties: each(g.properties) })),
    tabs: type.tabs.map((t) => ({
      ...t,
      properties: each(t.properties),
      groups: t.groups.map((g) => ({ ...g, properties: each(g.properties) })),
    })),
  }
}

const own = (type: SchemaContentType, alias: string) =>
  allProperties(type).find((p) => p.alias.toLowerCase() === alias.toLowerCase())

/** A property's name, description, validation, variance or data type. */
export function updateProperty(
  type: SchemaContentType,
  alias: string,
  changes: PropertyChanges,
): EditResult {
  const property = own(type, alias)
  if (!property) return refuse(`"${type.alias}" has no property "${alias}"`)
  const next: SchemaProperty = {
    ...property,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.description !== undefined ? { description: changes.description || undefined } : {}),
    ...(changes.mandatory !== undefined ? { mandatory: changes.mandatory } : {}),
    ...(changes.regex !== undefined ? { regex: changes.regex ?? undefined } : {}),
    ...(changes.regexMessage !== undefined
      ? { regexMessage: changes.regexMessage ?? undefined }
      : {}),
    ...(changes.variesByCulture !== undefined ? { variesByCulture: changes.variesByCulture } : {}),
    ...(changes.variesBySegment !== undefined ? { variesBySegment: changes.variesBySegment } : {}),
    ...(changes.dataType !== undefined ? { type: changes.dataType } : {}),
    ...(changes.memberCanView !== undefined ? { memberCanView: changes.memberCanView } : {}),
    ...(changes.memberCanEdit !== undefined ? { memberCanEdit: changes.memberCanEdit } : {}),
    ...(changes.sensitive !== undefined ? { sensitive: changes.sensitive } : {}),
  }
  return { ok: true, type: mapProperties(type, (p) => (p === property ? next : p)) }
}

/** A property taken out: retired by the sync, its values kept until `types purge`. */
export function removeProperty(type: SchemaContentType, alias: string): EditResult {
  const property = own(type, alias)
  if (!property) return refuse(`"${type.alias}" has no property "${alias}"`)
  return { ok: true, type: mapProperties(type, (p) => (p === property ? undefined : p)) }
}

export interface PropertyPlacement extends Placement {
  /** The tab it goes into; the one it is in when absent. */
  tab?: string
}

/** A property moved: to another tab, or before or after another property in its tab. */
export function moveProperty(
  type: SchemaContentType,
  alias: string,
  at: PropertyPlacement,
): EditResult {
  const property = own(type, alias)
  if (!property) return refuse(`"${type.alias}" has no property "${alias}"`)
  if (!at.tab && !at.before && !at.after)
    return refuse('say where: a tab, or before or after a property')
  const anchor = at.before ?? at.after
  const anchorTab = anchor
    ? type.tabs.find((t) =>
        t.properties.some((p) => p.alias.toLowerCase() === anchor.toLowerCase()),
      )
    : undefined
  if (anchor && !anchorTab)
    return refuse(`"${type.alias}" has no property "${anchor}" in a tab to put it beside`)
  const target = at.tab ? tabNamed(type, at.tab) : anchorTab
  if (!target) return refuse(`"${type.alias}" has no tab "${at.tab}"`)
  if (anchorTab && anchorTab !== target)
    return refuse(`"${anchor}" is in the tab "${anchorTab.name}", not "${target.name}"`)
  const removed = mapProperties(type, (p) => (p === property ? undefined : p))
  const tabs = removed.tabs.map((t) => {
    if (t.name !== target.name) return t
    const properties = place(t.properties, property, at, (p) => p.alias)
    return {
      ...t,
      properties: typeof properties === 'string' ? [...t.properties, property] : properties,
    }
  })
  return { ok: true, type: { ...removed, tabs } }
}

export type DataTypeEditResult =
  | { ok: true; dataType: SchemaDataType }
  | { ok: false; reason: string }

export interface DataTypeChanges {
  /** Settings stored as given, unchecked (story 249): they work when the editor uses the name. */
  set?: Record<string, unknown>
  unset?: readonly string[]
  /** The presets' options (`--max-chars`, `--multiple`…), written as `types new data-type` writes them. */
  options?: PresetOptions
  addBlock?: { element: string; label?: string; settings?: string }
  removeBlock?: string
  /** A picker's start node: the page's key, or null for none. */
  startNode?: string | null
}

const BLOCK_EDITORS = new Set(['Umbraco.BlockList', 'Umbraco.BlockGrid', 'Umbraco.RichText'])

/** The preset whose editor a data type uses, when there is one. */
const presetFor = (dataType: SchemaDataType) =>
  Object.entries(DATA_TYPE_PRESETS).find(([, preset]) => preset.editor === dataType.editor)

/** The settings a preset's options write, and only those: the rest of the data type is left as it is. */
function presetSettings(
  dataType: SchemaDataType,
  options: PresetOptions,
): Record<string, unknown> | string {
  const given = Object.entries(options).filter(([, value]) => value !== undefined)
  if (given.length === 0) return {}
  const found = presetFor(dataType)
  if (!found) return `"${dataType.editor}" takes no named settings: use --set <setting>=<value>`
  const [name, preset] = found
  const unknown = given.filter(([option]) => !preset.takes.includes(option as keyof PresetOptions))
  if (unknown.length > 0)
    return `${unknown.map(([option]) => optionFlag(option)).join(', ')} does not apply to ${name}: it takes ${preset.takes.map(optionFlag).join(', ') || 'no named settings'}`
  const without = preset.build({}).config
  const withThem = preset.build(options).config
  return Object.fromEntries(
    Object.entries(withThem).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(without[key]),
    ),
  )
}

/** A data type's settings, blocks or start node. */
export function updateDataType(
  dataType: SchemaDataType,
  changes: DataTypeChanges,
): DataTypeEditResult {
  const named = presetSettings(dataType, changes.options ?? {})
  if (typeof named === 'string') return { ok: false, reason: named }
  const config: Record<string, unknown> = { ...dataType.config, ...named, ...changes.set }
  for (const setting of changes.unset ?? []) {
    if (!(setting in config))
      return { ok: false, reason: `"${dataType.alias}" has no setting "${setting}"` }
    delete config[setting]
  }
  if (changes.startNode !== undefined) {
    const current = (config.startNode ?? { type: 'content' }) as Record<string, unknown>
    if (changes.startNode === null) {
      const { id: _id, ...rest } = current
      config.startNode = rest
    } else config.startNode = { ...current, id: changes.startNode }
  }
  let blocks = dataType.blocks
  if (changes.addBlock || changes.removeBlock) {
    if (!BLOCK_EDITORS.has(dataType.editor))
      return {
        ok: false,
        reason: `"${dataType.alias}" is a ${dataType.editor}, which has no blocks`,
      }
    const list = [...(dataType.blocks ?? [])]
    if (changes.addBlock) {
      if (list.some((b) => b.element === changes.addBlock?.element))
        return {
          ok: false,
          reason: `"${dataType.alias}" already offers "${changes.addBlock.element}"`,
        }
      list.push({
        element: changes.addBlock.element,
        ...(changes.addBlock.label ? { label: changes.addBlock.label } : {}),
        ...(changes.addBlock.settings ? { settings: changes.addBlock.settings } : {}),
      })
    }
    if (changes.removeBlock) {
      const index = list.findIndex((b) => b.element === changes.removeBlock)
      if (index < 0)
        return { ok: false, reason: `"${dataType.alias}" does not offer "${changes.removeBlock}"` }
      list.splice(index, 1)
    }
    blocks = list
  }
  return { ok: true, dataType: { ...dataType, config, ...(blocks ? { blocks } : {}) } }
}
