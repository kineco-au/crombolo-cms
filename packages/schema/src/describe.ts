/**
 * A site's definitions described for a person (story 247): the rows
 * `crombolo types list` prints, the detail `types show` prints, and what uses
 * each one, read from a loaded `SchemaSet` alone. Pure, so stories 248 to 251
 * reuse it to say what a change touches.
 */
import { BUILTIN_DATA_TYPES } from './builtin.ts'
import { composedProperties, type PlacedProperty, placedProperties } from './compositions.ts'
import {
  allProperties,
  type SchemaContentType,
  type SchemaDataType,
  type SchemaSet,
} from './model.ts'

/** What a definition is, as a person names it. */
export type DescribedKind = 'content' | 'element' | 'media' | 'member' | 'data'

export const DESCRIBED_KINDS: readonly DescribedKind[] = [
  'content',
  'element',
  'media',
  'member',
  'data',
]

export interface TypeRow {
  alias: string
  name: string
  kind: DescribedKind
  icon: string | null
  /** Properties, for a type; the editor, for a data type. */
  properties: number | null
  editor: string | null
  builtIn: boolean
}

/** One way a definition is used by another. */
export interface Use {
  /** What uses it: a type's alias, or a data type's. */
  by: string
  byKind: DescribedKind
  /** The property, when it is a property that uses it. */
  property?: string
  how:
    | 'allowed child'
    | 'composition'
    | 'block'
    | 'block settings'
    | 'picker allows'
    | 'property of this data type'
}

export interface PropertyDetail {
  alias: string
  name: string
  tab: string | null
  group: string | null
  dataType: string
  mandatory: boolean
  variesByCulture: boolean
  variesBySegment: boolean
  description: string | null
  /** The composition that defines it; null for the type's own (story 255). */
  from: string | null
  /** The composition it comes through, when that is not the one defining it. */
  via: string | null
}

export interface TypeDetail {
  kind: Exclude<DescribedKind, 'data'>
  alias: string
  name: string
  description: string | null
  icon: string | null
  allowAtRoot: boolean
  allowChildren: string[]
  compositions: string[]
  views: string[]
  defaultView: string | null
  variesByCulture: boolean
  variesBySegment: boolean
  library: boolean
  listView: string | null
  tabs: string[]
  properties: PropertyDetail[]
  usedBy: Use[]
}

export interface DataTypeDetail {
  kind: 'data'
  alias: string
  name: string
  editor: string
  builtIn: boolean
  /** Its settings by their own names, with the plain name where one is known. */
  settings: Array<{ setting: string; label: string | null; value: unknown }>
  blocks: Array<{ element: string; settings: string | null; label: string | null }>
  usedBy: Use[]
}

/** Plain names for the settings `types new data-type` already names (story 161). */
const SETTING_LABELS: Record<string, string> = {
  maxChars: 'Most characters',
  rows: 'Rows',
  min: 'Minimum',
  max: 'Maximum',
  step: 'Step',
  default: 'Starts on',
  labelOn: 'Label',
  format: 'Format',
  multiple: 'More than one may be chosen',
  items: 'Options',
  filter: 'Allows',
  allowedContentTypes: 'Allows',
  startNode: 'Starts at',
  validationLimit: 'How many',
  gridColumns: 'Columns',
}

const typesOf = (set: SchemaSet) => [
  ...set.contentTypes.map((type) => ({
    type,
    kind: (type.isElement ? 'element' : 'content') as Exclude<DescribedKind, 'data'>,
  })),
  ...(set.mediaTypes ?? []).map((type) => ({ type, kind: 'media' as const })),
  ...(set.memberTypes ?? []).map((type) => ({ type, kind: 'member' as const })),
]

const builtInAliases = new Set(BUILTIN_DATA_TYPES.map((dataType) => dataType.alias))

/** The site's data types and the built-in ones it has not replaced. */
function dataTypesOf(set: SchemaSet): Array<{ dataType: SchemaDataType; builtIn: boolean }> {
  const own = new Set(set.dataTypes.map((dataType) => dataType.alias))
  return [
    ...set.dataTypes.map((dataType) => ({ dataType, builtIn: false })),
    ...BUILTIN_DATA_TYPES.filter((dataType) => !own.has(dataType.alias)).map((dataType) => ({
      dataType,
      builtIn: true,
    })),
  ]
}

/** Every row `types list` prints, types then data types, each by alias. */
export function listTypes(
  set: SchemaSet,
  options: { kind?: DescribedKind; own?: boolean } = {},
): TypeRow[] {
  const rows: TypeRow[] = [
    ...typesOf(set).map(({ type, kind }) => ({
      alias: type.alias,
      name: type.name,
      kind,
      icon: type.icon || null,
      properties: allProperties(type).length,
      editor: null,
      builtIn: false,
    })),
    ...dataTypesOf(set).map(({ dataType, builtIn }) => ({
      alias: dataType.alias,
      name: dataType.name,
      kind: 'data' as const,
      icon: null,
      properties: null,
      editor: dataType.editor,
      builtIn,
    })),
  ]
  return rows
    .filter((row) => !options.kind || row.kind === options.kind)
    .filter((row) => !options.own || !row.builtIn)
    .sort((a, b) =>
      a.kind === b.kind
        ? a.alias.localeCompare(b.alias)
        : DESCRIBED_KINDS.indexOf(a.kind) - DESCRIBED_KINDS.indexOf(b.kind),
    )
}

/** A picker's allowed types, whichever way its setting is written. */
function allowedBy(config: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const setting of ['filter', 'allowedContentTypes']) {
    const value = config[setting]
    if (typeof value === 'string')
      out.push(
        ...value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      )
    else if (Array.isArray(value))
      for (const part of value) if (typeof part === 'string') out.push(part)
  }
  return out
}

/** Everything in the set that uses `alias`, as a type or as a data type. */
export function usesOf(set: SchemaSet, alias: string): Use[] {
  const uses: Use[] = []
  for (const { type, kind } of typesOf(set)) {
    if (type.allowChildren.includes(alias))
      uses.push({ by: type.alias, byKind: kind, how: 'allowed child' })
    if (type.compositions.includes(alias))
      uses.push({ by: type.alias, byKind: kind, how: 'composition' })
    for (const property of allProperties(type))
      if (property.type === alias)
        uses.push({
          by: type.alias,
          byKind: kind,
          property: property.alias,
          how: 'property of this data type',
        })
  }
  for (const { dataType } of dataTypesOf(set)) {
    for (const block of dataType.blocks ?? []) {
      if (block.element === alias) uses.push({ by: dataType.alias, byKind: 'data', how: 'block' })
      if (block.settings === alias)
        uses.push({ by: dataType.alias, byKind: 'data', how: 'block settings' })
    }
    if (allowedBy(dataType.config).includes(alias))
      uses.push({ by: dataType.alias, byKind: 'data', how: 'picker allows' })
  }
  return uses
}

/**
 * A type's properties, its own and its compositions', in its tabs: a
 * composition's tab merges into the type's tab of the same name, as the back
 * office shows it.
 */
function propertyDetails(set: SchemaSet, type: SchemaContentType): PropertyDetail[] {
  const detail = (
    { property, tab, group }: PlacedProperty,
    from: string | null,
    via: string | null,
  ): PropertyDetail => ({
    alias: property.alias,
    name: property.name,
    tab,
    group,
    dataType: property.type,
    mandatory: property.mandatory,
    variesByCulture: property.variesByCulture,
    variesBySegment: property.variesBySegment,
    description: property.description ?? null,
    from,
    via,
  })
  const all = [
    ...placedProperties(type).map((p) => detail(p, null, null)),
    ...composedProperties(set, type).map((p) => detail(p, p.from, p.via ?? null)),
  ]
  const tabs: Array<string | null> = []
  for (const p of all) if (!tabs.includes(p.tab)) tabs.push(p.tab)
  const place = (p: PropertyDetail) => tabs.indexOf(p.tab)
  return all
    .map((p, i) => ({ p, i }))
    .sort((a, b) => place(a.p) - place(b.p) || a.i - b.i)
    .map(({ p }) => p)
}

export type Described = TypeDetail | DataTypeDetail

export type FindResult =
  | { ok: true; found: Described }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'ambiguous'; kinds: DescribedKind[] }

/** The definition an alias names, or why none is picked: none, or more than one kind. */
export function describeType(set: SchemaSet, alias: string, kind?: DescribedKind): FindResult {
  const wanted = alias.toLowerCase()
  const types = typesOf(set).filter(
    ({ type, kind: k }) => type.alias.toLowerCase() === wanted && (!kind || k === kind),
  )
  const dataTypes =
    kind && kind !== 'data'
      ? []
      : dataTypesOf(set).filter(({ dataType }) => dataType.alias.toLowerCase() === wanted)
  const kinds = [...types.map((t) => t.kind), ...dataTypes.map(() => 'data' as const)]
  if (kinds.length === 0) return { ok: false, reason: 'not-found' }
  if (kinds.length > 1) return { ok: false, reason: 'ambiguous', kinds }
  const [match] = types
  if (match) {
    const { type, kind: k } = match
    return {
      ok: true,
      found: {
        kind: k,
        alias: type.alias,
        name: type.name,
        description: type.description ?? null,
        icon: type.icon || null,
        allowAtRoot: type.allowAtRoot,
        allowChildren: [...type.allowChildren],
        compositions: [...type.compositions],
        views: [...type.components],
        defaultView: type.defaultComponent ?? null,
        variesByCulture: type.variesByCulture,
        variesBySegment: type.variesBySegment,
        library: type.allowInLibrary,
        listView: type.collection ?? null,
        tabs: type.tabs.map((tab) => tab.name),
        properties: propertyDetails(set, type),
        usedBy: usesOf(set, type.alias),
      },
    }
  }
  const { dataType, builtIn } = dataTypes[0] as { dataType: SchemaDataType; builtIn: boolean }
  return {
    ok: true,
    found: {
      kind: 'data',
      alias: dataType.alias,
      name: dataType.name,
      editor: dataType.editor,
      builtIn,
      settings: Object.entries(dataType.config).map(([setting, value]) => ({
        setting,
        label: SETTING_LABELS[setting] ?? null,
        value,
      })),
      blocks: (dataType.blocks ?? []).map((block) => ({
        element: block.element,
        settings: block.settings ?? null,
        label: block.label ?? null,
      })),
      usedBy: usesOf(set, dataType.alias),
    },
  }
}

/** Whether a built-in data type: one a site uses without defining it. */
export const isBuiltInDataType = (alias: string): boolean => builtInAliases.has(alias)
