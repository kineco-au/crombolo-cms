/**
 * Server validation of block values (story 456), as Umbraco's: a list's or grid's
 * limits, the block types a property and a grid area offer, and every property
 * inside a block, at any depth and per culture exposed. Pure: element types are
 * looked up through the caller. `docs/content-validation.md` explains the rules.
 */
import { BLOCK_EDITORS, type Block, type BlockData, blockValueOf, readBlocks } from './blocks.ts'

const RICH_TEXT_EDITOR_ALIAS = 'Umbraco.RichText'
const BLOCK_GRID_EDITOR_ALIAS = 'Umbraco.BlockGrid'

/** What validation reads of a property type, top level or inside a block. */
export interface ValidatedProperty {
  alias: string
  name?: string
  editorAlias: string
  config: Record<string, unknown>
  variesByCulture: boolean
  mandatory: boolean
  mandatoryMessage: string | null
  regEx: string | null
  regExMessage: string | null
  pending?: boolean
}

/** An element type, as blocks inside a value are validated against it. */
export interface ValidatedElementType {
  key: string
  name: string
  properties: readonly ValidatedProperty[]
}

/**
 * One problem in a value: `path` continues the value's own path
 * (`` for the value itself, `.contentData[0].values[?(…)].value` inside a block),
 * as Umbraco 14+ answers it.
 */
export interface ValueProblem {
  path: string
  messages: string[]
}

/** Umbraco's wording, filled in. */
export const blockMessages = {
  empty: 'Value cannot be empty',
  pattern: 'Value is invalid, it does not match the correct pattern',
  tooFew: (min: number, count: number) => `Minimum ${min} entries, requires ${min - count} more.`,
  tooMany: (max: number, count: number) => `Maximum ${max} entries, ${count - max} too many.`,
  notAllowed: (name: string) => `${name} is not allowed at this spot.`,
  areas: 'The content amount requirements are not met for one or more areas.',
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const lower = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '')

const num = (value: unknown): number | undefined => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** Whether a value counts as empty for a mandatory rule: blocks with none, text blank. */
export function isEmptyValue(editorAlias: string, value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (BLOCK_EDITORS.has(editorAlias) && editorAlias !== RICH_TEXT_EDITOR_ALIAS) {
    const block = blockValueOf(editorAlias, value)
    return !block || readBlocks(block).length === 0
  }
  return false
}

/** A property's own mandatory and pattern messages for one value. */
export function propertyMessages(property: ValidatedProperty, value: unknown): string[] {
  const messages: string[] = []
  const empty = isEmptyValue(property.editorAlias, value)
  if (property.mandatory && empty) messages.push(property.mandatoryMessage || blockMessages.empty)
  if (property.regEx && !empty && typeof value === 'string') {
    let matches = true
    try {
      matches = new RegExp(property.regEx).test(value)
    } catch {
      matches = true
    }
    if (!matches) messages.push(property.regExMessage || blockMessages.pattern)
  }
  return messages
}

/** Every element type key a value's blocks name, at any depth, as far as known types reach. */
export function blockTypeKeys(
  editorAlias: string,
  value: unknown,
  elementType: (key: string) => ValidatedElementType | undefined,
): string[] {
  const keys = new Set<string>()
  const visit = (alias: string, own: unknown) => {
    const block = blockValueOf(alias, own)
    if (!block) return
    for (const data of [...(block.contentData ?? []), ...(block.settingsData ?? [])]) {
      if (!isRecord(data) || typeof data.contentTypeKey !== 'string') continue
      keys.add(data.contentTypeKey)
      const type = elementType(data.contentTypeKey)
      for (const v of (data as BlockData).values ?? []) {
        const editor = type?.properties.find((p) => p.alias === v.alias)?.editorAlias
        visit(editor ?? v.editorAlias ?? '', v.value)
      }
    }
  }
  if (BLOCK_EDITORS.has(editorAlias)) visit(editorAlias, value)
  return [...keys]
}

interface BlockConfig {
  contentElementTypeKey?: unknown
  settingsElementTypeKey?: unknown
  groupKey?: unknown
  allowAtRoot?: unknown
  allowInAreas?: unknown
  areas?: unknown
}

interface AreaConfig {
  key?: unknown
  minAllowed?: unknown
  maxAllowed?: unknown
  specifiedAllowance?: unknown
}

const q = (s: string | null) => (s === null ? 'null' : `'${s}'`)

/** Umbraco's filter for one value inside a block's `values`. */
export const blockValuePath = (alias: string, culture: string | null, segment: string | null) =>
  `.values[?(@.alias == '${alias}' && @.culture == ${q(culture)} && @.segment == ${q(segment)})].value`

/**
 * The problems Umbraco would refuse in one block editor value: counts, block types
 * offered, grid areas, and each block's properties, recursing into blocks within
 * blocks. `cultures` are those being validated; a culture-variant block is checked
 * in each of them its `expose` names.
 */
export function blockValueProblems(
  property: Pick<ValidatedProperty, 'editorAlias' | 'config'>,
  value: unknown,
  elementType: (key: string) => ValidatedElementType | undefined,
  cultures: readonly string[],
): ValueProblem[] {
  if (!BLOCK_EDITORS.has(property.editorAlias)) return []
  const isRichText = property.editorAlias === RICH_TEXT_EDITOR_ALIAS
  const config = property.config ?? {}
  const limit = isRecord(config.validationLimit) ? config.validationLimit : {}
  const min = num(limit.min)
  const max = num(limit.max)
  const block = blockValueOf(property.editorAlias, value)
  if (!block)
    return min !== undefined && min > 0 && !isRichText
      ? [{ path: '', messages: [blockMessages.tooFew(min, 0)] }]
      : []
  const base = isRichText ? '.blocks' : ''
  const problems: ValueProblem[] = []
  const add = (path: string, message: string) => {
    const found = problems.find((p) => p.path === path)
    if (found) {
      if (!found.messages.includes(message)) found.messages.push(message)
    } else problems.push({ path, messages: [message] })
  }
  const offered = (Array.isArray(config.blocks) ? config.blocks : []).filter(
    isRecord,
  ) as BlockConfig[]
  const configOf = (key: string) =>
    offered.find((b) => lower(b.contentElementTypeKey) === lower(key))
  const contentData = (block.contentData ?? []).filter(isRecord) as BlockData[]
  const settingsData = (block.settingsData ?? []).filter(isRecord) as BlockData[]
  const contentIndex = new Map(contentData.map((d, i) => [d.key, i]))
  const settingsIndex = new Map(settingsData.map((d, i) => [d.key, i]))
  const expose = Array.isArray((block as { expose?: unknown }).expose)
    ? ((block as { expose: unknown[] }).expose.filter(isRecord) as Array<{
        contentKey?: unknown
        culture?: unknown
      }>)
    : undefined
  const nameOf = (key: string) => elementType(key)?.name ?? key
  const isGrid = property.editorAlias === BLOCK_GRID_EDITOR_ALIAS
  const roots = readBlocks(block)

  if (min !== undefined && min > 0 && roots.length < min)
    add(base, blockMessages.tooFew(min, roots.length))
  if (max !== undefined && max > 0 && roots.length > max)
    add(base, blockMessages.tooMany(max, roots.length))

  const culturesOf = (contentKey: string): string[] => {
    if (!expose) return [...cultures]
    const named = expose
      .filter((e) => lower(e.contentKey) === lower(contentKey))
      .map((e) => e.culture)
      .filter((c): c is string => typeof c === 'string')
    return cultures.filter((c) => named.some((n) => n.toLowerCase() === c.toLowerCase()))
  }

  const checkData = (data: BlockData, path: string, exposed: readonly string[]) => {
    const type = elementType(data.contentTypeKey)
    if (!type) return
    const values = data.values ?? []
    for (const prop of type.properties) {
      if (prop.pending) continue
      const targets: Array<string | null> = prop.variesByCulture ? [...exposed] : [null]
      for (const culture of targets) {
        const own = values.find(
          (v) =>
            v.alias === prop.alias &&
            (prop.variesByCulture
              ? lower(v.culture) === lower(culture)
              : (v.culture ?? null) === null) &&
            (v.segment ?? null) === null,
        )
        const at = `${path}${blockValuePath(prop.alias, culture, null)}`
        for (const message of propertyMessages(prop, own?.value)) add(at, message)
        if (own && BLOCK_EDITORS.has(prop.editorAlias))
          for (const inner of blockValueProblems(
            prop,
            own.value,
            elementType,
            culture === null ? cultures : [culture],
          ))
            for (const message of inner.messages) add(`${at}${inner.path}`, message)
      }
    }
  }

  const allowance = (area: AreaConfig) =>
    (Array.isArray(area.specifiedAllowance) ? area.specifiedAllowance : []).filter(
      isRecord,
    ) as Array<{
      elementTypeKey?: unknown
      groupKey?: unknown
      minAllowed?: unknown
      maxAllowed?: unknown
    }>

  const matches = (
    rule: { elementTypeKey?: unknown; groupKey?: unknown },
    key: string,
  ): boolean => {
    if (rule.elementTypeKey) return lower(rule.elementTypeKey) === lower(key)
    if (rule.groupKey) return lower(configOf(key)?.groupKey) === lower(rule.groupKey)
    return false
  }

  const visit = (blocks: Block[], area: AreaConfig | null) => {
    for (const entry of blocks) {
      const content = entry.content
      if (!content) continue
      const index = contentIndex.get(content.key)
      const contentPath = `${base}.contentData[${index}]`
      const own = configOf(content.contentTypeKey)
      if (offered.length > 0) {
        let allowed = own !== undefined
        if (allowed && isGrid) {
          if (area === null) allowed = own?.allowAtRoot !== false
          else {
            const rules = allowance(area)
            allowed =
              rules.length > 0
                ? rules.some((r) => matches(r, content.contentTypeKey))
                : own?.allowInAreas !== false
          }
        }
        if (!allowed) add(contentPath, blockMessages.notAllowed(nameOf(content.contentTypeKey)))
      }
      const exposed = culturesOf(content.key)
      checkData(content, contentPath, exposed)
      const settings = entry.settings
      if (settings) {
        const settingsPath = `${base}.settingsData[${settingsIndex.get(settings.key)}]`
        if (own && lower(own.settingsElementTypeKey) !== lower(settings.contentTypeKey))
          add(settingsPath, blockMessages.notAllowed(nameOf(settings.contentTypeKey)))
        checkData(settings, settingsPath, exposed)
      }
      if (isGrid) {
        const declared = (Array.isArray(own?.areas) ? own.areas : []).filter(
          isRecord,
        ) as AreaConfig[]
        let mismatch = false
        for (const inner of entry.areas) {
          const areaConfig = declared.find((a) => lower(a.key) === lower(inner.key)) ?? null
          if (areaConfig) {
            const count = inner.blocks.filter((b) => b.content).length
            const areaMin = num(areaConfig.minAllowed)
            const areaMax = num(areaConfig.maxAllowed)
            if (areaMin !== undefined && count < areaMin) mismatch = true
            if (areaMax !== undefined && areaMax > 0 && count > areaMax) mismatch = true
            for (const rule of allowance(areaConfig)) {
              const ruled = inner.blocks.filter(
                (b) => b.content && matches(rule, b.content.contentTypeKey),
              ).length
              const ruleMin = num(rule.minAllowed)
              const ruleMax = num(rule.maxAllowed)
              if (ruleMin !== undefined && ruled < ruleMin) mismatch = true
              if (ruleMax !== undefined && ruleMax > 0 && ruled > ruleMax) mismatch = true
            }
          }
          visit(inner.blocks, areaConfig ?? {})
        }
        for (const areaConfig of declared) {
          if (entry.areas.some((a) => lower(a.key) === lower(areaConfig.key))) continue
          const areaMin = num(areaConfig.minAllowed)
          const ruleMin = allowance(areaConfig).some((r) => (num(r.minAllowed) ?? 0) > 0)
          if ((areaMin ?? 0) > 0 || ruleMin) mismatch = true
        }
        if (mismatch) add(contentPath, blockMessages.areas)
      }
    }
  }
  visit(roots, null)
  return problems
}

/**
 * A validation error's full path from the page, as Umbraco 14+ says it:
 * `$.values[?(@.alias == 'blocks' && …)].value`, continued into a block.
 */
export function validationPath(error: {
  alias: string
  culture: string | null
  segment: string | null
  path?: string
}): string {
  return `$.values[?(@.alias == '${error.alias}' && @.culture == ${q(error.culture)} && @.segment == ${q(error.segment)})].value${error.path ?? ''}`
}
