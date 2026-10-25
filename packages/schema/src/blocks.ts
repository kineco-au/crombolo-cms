/**
 * Block editors' blocks as `[[data-type.block]]` tables (story 161): each
 * names its element and settings types by alias, with its label, size, group
 * and, in a grid, its spans and areas. Sync compiles them into the config the
 * back office reads — `blocks`, and `blockGroups` for named groups — and export
 * turns that config back into tables when every block can be said as one.
 * Group and area keys are derived, so every node computes the same ones.
 */
import { derivedKey } from '@crombolo/core'
import type { ConfigReferenceProblem } from './config-references.ts'
import type { SchemaBlock, SchemaBlockAllowance, SchemaBlockArea } from './model.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const defined = <T extends Record<string, unknown>>(record: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>

/**
 * The editor config the tables stand for. `lookup` answers an element type's
 * key by alias; an alias it cannot answer is reported and left out.
 */
export function compileBlocks(
  dataTypeKey: string,
  blocks: readonly SchemaBlock[],
  lookup: (alias: string) => string | undefined,
): { config: Record<string, unknown>; problems: ConfigReferenceProblem[] } {
  const problems: ConfigReferenceProblem[] = []
  const element = (alias: string, path: string): string | undefined => {
    const key = lookup(alias)
    if (!key) problems.push({ path, alias, kind: 'element' })
    return key
  }
  const groupNames = [...new Set(blocks.flatMap((b) => (b.group ? [b.group] : [])))]
  const groupKey = (name: string) => derivedKey(dataTypeKey, 'group', name)
  const allowance = (entry: SchemaBlockAllowance, path: string) =>
    defined({
      elementTypeKey: entry.element ? element(entry.element, path) : undefined,
      groupKey: entry.group ? groupKey(entry.group) : undefined,
      minAllowed: entry.min,
      maxAllowed: entry.max,
    })
  const area = (owner: string, a: SchemaBlockArea, path: string) =>
    defined({
      key: derivedKey(dataTypeKey, owner, a.alias),
      alias: a.alias,
      columnSpan: a.columnSpan,
      rowSpan: a.rowSpan,
      createLabel: a.createLabel,
      minAllowed: a.min,
      maxAllowed: a.max,
      specifiedAllowance: a.allow?.map((entry, index) =>
        allowance(entry, `${path}.allow[${index}]`),
      ),
    })
  const compiled = blocks.map((b, index) => {
    const path = `block[${index}]`
    return defined({
      contentElementTypeKey: element(b.element, `${path}.element`),
      settingsElementTypeKey: b.settings ? element(b.settings, `${path}.settings`) : undefined,
      label: b.label,
      editorSize: b.size,
      backgroundColor: b.background,
      iconColor: b.iconColor,
      thumbnail: b.thumbnail,
      groupKey: b.group ? groupKey(b.group) : undefined,
      allowAtRoot: b.allowAtRoot,
      allowInAreas: b.allowInAreas,
      columnSpanOptions: b.columnSpans?.map((columnSpan) => ({ columnSpan })),
      rowMinSpan: b.rowSpan?.min,
      rowMaxSpan: b.rowSpan?.max,
      areaGridColumns: b.areaColumns,
      areas: b.areas?.map((a, i) => area(b.element, a, `${path}.area[${i}]`)),
    })
  })
  const config: Record<string, unknown> = { blocks: compiled }
  if (groupNames.length > 0)
    config.blockGroups = groupNames.map((name) => ({ key: groupKey(name), name }))
  return { config, problems }
}

const BLOCK_FIELDS = new Set([
  'contentElementTypeKey',
  'settingsElementTypeKey',
  'label',
  'editorSize',
  'backgroundColor',
  'iconColor',
  'thumbnail',
  'groupKey',
  'allowAtRoot',
  'allowInAreas',
  'columnSpanOptions',
  'rowMinSpan',
  'rowMaxSpan',
  'areaGridColumns',
  'areas',
])
const AREA_FIELDS = new Set([
  'key',
  'alias',
  'columnSpan',
  'rowSpan',
  'createLabel',
  'minAllowed',
  'maxAllowed',
  'specifiedAllowance',
])

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const num = (value: unknown) => (typeof value === 'number' ? value : undefined)
const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined)

/**
 * Tables from an editor's config, or undefined when a block uses something a
 * table cannot say, so the raw config is kept rather than half-translated.
 * `reverse` answers a type's alias by key.
 */
export function decompileBlocks(
  config: Record<string, unknown>,
  reverse: (key: string) => string | undefined,
): SchemaBlock[] | undefined {
  if (!Array.isArray(config.blocks) || config.blocks.length === 0) return undefined
  const groups = new Map(
    (Array.isArray(config.blockGroups) ? config.blockGroups : [])
      .filter(isRecord)
      .map((g) => [String(g.key).toLowerCase(), String(g.name)]),
  )
  const groupOf = (key: unknown) =>
    typeof key === 'string' ? groups.get(key.toLowerCase()) : undefined
  const aliasOf = (key: unknown) => (typeof key === 'string' ? reverse(key) : undefined)
  const out: SchemaBlock[] = []
  for (const raw of config.blocks) {
    if (!isRecord(raw) || Object.keys(raw).some((field) => !BLOCK_FIELDS.has(field)))
      return undefined
    const element = aliasOf(raw.contentElementTypeKey)
    if (!element) return undefined
    const settings = raw.settingsElementTypeKey ? aliasOf(raw.settingsElementTypeKey) : undefined
    if (raw.settingsElementTypeKey && !settings) return undefined
    if (raw.groupKey && !groupOf(raw.groupKey)) return undefined
    const areas: SchemaBlockArea[] = []
    for (const a of Array.isArray(raw.areas) ? raw.areas : []) {
      if (!isRecord(a) || Object.keys(a).some((field) => !AREA_FIELDS.has(field))) return undefined
      const allow: SchemaBlockAllowance[] = []
      for (const s of Array.isArray(a.specifiedAllowance) ? a.specifiedAllowance : []) {
        if (!isRecord(s)) return undefined
        const entry: SchemaBlockAllowance = defined({
          element: s.elementTypeKey ? aliasOf(s.elementTypeKey) : undefined,
          group: s.groupKey ? groupOf(s.groupKey) : undefined,
          min: num(s.minAllowed),
          max: num(s.maxAllowed),
        })
        if (!entry.element && !entry.group) return undefined
        allow.push(entry)
      }
      areas.push(
        defined({
          alias: String(a.alias ?? ''),
          columnSpan: num(a.columnSpan),
          rowSpan: num(a.rowSpan),
          createLabel: str(a.createLabel),
          min: num(a.minAllowed),
          max: num(a.maxAllowed),
          allow: allow.length > 0 ? allow : undefined,
        }) as SchemaBlockArea,
      )
    }
    const spans = Array.isArray(raw.columnSpanOptions)
      ? raw.columnSpanOptions.flatMap((o) =>
          isRecord(o) && typeof o.columnSpan === 'number' ? [o.columnSpan] : [],
        )
      : undefined
    out.push(
      defined({
        element,
        settings,
        label: str(raw.label),
        size: str(raw.editorSize),
        background: str(raw.backgroundColor),
        iconColor: str(raw.iconColor),
        thumbnail: str(raw.thumbnail),
        group: groupOf(raw.groupKey),
        allowAtRoot: bool(raw.allowAtRoot),
        allowInAreas: bool(raw.allowInAreas),
        columnSpans: spans && spans.length > 0 ? spans : undefined,
        rowSpan:
          num(raw.rowMinSpan) !== undefined || num(raw.rowMaxSpan) !== undefined
            ? defined({ min: num(raw.rowMinSpan), max: num(raw.rowMaxSpan) })
            : undefined,
        areaColumns: num(raw.areaGridColumns),
        areas: areas.length > 0 ? areas : undefined,
      }) as SchemaBlock,
    )
  }
  return out
}
