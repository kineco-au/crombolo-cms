/**
 * `crombolo generate`: TypeScript for the content types in a schema set, so a
 * view can name a property and have the compiler check it. Umbraco's
 * ModelsBuilder, minus the DLL.
 */
import { BUILT_IN_MEDIA_TYPES, SYSTEM_CONTENT_TYPES } from '@crombolo/data'
import {
  BUILTIN_DATA_TYPES,
  builtInContentTypeSchema,
  builtInMediaTypeSchema,
  storageTypeFor,
} from './builtin.ts'
import { typeKeyFor } from './keys.ts'
import { allProperties, type SchemaBlock, type SchemaContentType, type SchemaSet } from './model.ts'

export function pascal(alias: string): string {
  const cleaned = alias.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    next ? next.toUpperCase() : '',
  )
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/**
 * A content type a data type names: by alias, by the key its file gives, or by
 * the key it derives (story 161).
 */
export function contentTypeAliasOf(set: SchemaSet, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const wanted = value.trim().toLowerCase()
  return set.contentTypes.find(
    (t) =>
      t.alias.toLowerCase() === wanted ||
      (t.key ?? typeKeyFor('document', t.alias)).toLowerCase() === wanted,
  )?.alias
}

/** The element types a block data type allows, by alias, for its content and its settings. */
export function blockElements(
  set: SchemaSet,
  config: Record<string, unknown>,
  tables?: readonly SchemaBlock[],
) {
  if (tables)
    return {
      content: [...new Set(tables.map((b) => b.element))],
      settings: [...new Set(tables.flatMap((b) => (b.settings ? [b.settings] : [])))],
    }
  const blocks = Array.isArray(config.blocks)
    ? (config.blocks as Array<Record<string, unknown>>)
    : []
  const content = blocks.flatMap((b) => contentTypeAliasOf(set, b.contentElementTypeKey) ?? [])
  const settings = blocks.flatMap((b) => contentTypeAliasOf(set, b.settingsElementTypeKey) ?? [])
  return { content: [...new Set(content)], settings: [...new Set(settings)] }
}

const elementUnion = (aliases: string[]) =>
  aliases.length === 0
    ? 'PublishedElement'
    : aliases.map((a) => `TypedElement<${pascal(a)}>`).join(' | ')

/** A data type's editor and configuration, the site's own or a built-in one. */
export function dataTypeOf(
  set: SchemaSet,
  dataTypeAlias: string,
): {
  editor: string | undefined
  config: Record<string, unknown>
  blocks?: readonly SchemaBlock[]
} {
  const custom = set.dataTypes.find((d) => d.alias === dataTypeAlias)
  const builtIn = BUILTIN_DATA_TYPES.find((b) => b.alias === dataTypeAlias)
  return {
    editor: custom?.editor ?? builtIn?.editor,
    config: (custom?.config ?? builtIn?.config ?? {}) as Record<string, unknown>,
    blocks: custom?.blocks,
  }
}

/** What a template receives for a property of this data type (see `@crombolo/render` values). */
function tsTypeFor(set: SchemaSet, dataTypeAlias: string): string {
  const { editor, config, blocks } = dataTypeOf(set, dataTypeAlias)
  if (!editor) return 'unknown'
  switch (editor) {
    case 'Umbraco.TrueFalse':
      return 'boolean'
    case 'Umbraco.ContentPicker':
      return 'PublishedContent | null'
    case 'Umbraco.MultiNodeTreePicker':
      return 'PublishedContent[]'
    case 'Umbraco.MultiUrlPicker':
      return 'Link[]'
    case 'Umbraco.ElementPicker': {
      // `allowedContentTypes` is a comma-separated list of element type keys, as
      // Umbraco's AllowedContentTypeKeysParser reads it. Narrowing to those types
      // is what makes `hero.value('body')` typed rather than `unknown`.
      const raw = config.allowedContentTypes
      const allowed = Array.isArray(raw)
        ? raw.map(String)
        : typeof raw === 'string'
          ? raw.split(',')
          : []
      const aliases = allowed
        .map((value) => value.trim())
        .filter(Boolean)
        .flatMap((value) => contentTypeAliasOf(set, value) ?? [])
      // `Array<>` not `[]`: a union of two element types would otherwise bind as
      // `A | (B[])`.
      return `Array<${elementUnion([...new Set(aliases)])}>`
    }
    case 'Umbraco.Tags':
    case 'Umbraco.CheckBoxList':
    case 'Umbraco.DropDown.Flexible':
    case 'Umbraco.MultipleTextstring':
      return 'string[]'
    case 'Umbraco.UploadField':
      return 'string'
    case 'Umbraco.BlockList': {
      const { content, settings } = blockElements(set, config, blocks)
      return `Array<BlockItem & { content: ${elementUnion(content)}; settings: ${settings.length ? `${elementUnion(settings)} | null` : 'PublishedElement | null'} }>`
    }
    case 'Umbraco.BlockGrid': {
      const { content } = blockElements(set, config, blocks)
      return `Array<BlockGridItem & { content: ${elementUnion(content)} }>`
    }
  }
  switch (storageTypeFor(editor)) {
    case 'Integer':
    case 'Decimal':
      return 'number'
    case 'Date':
    case 'Nvarchar':
      return 'string'
    default:
      return editor === 'Umbraco.TextArea' || editor === 'Umbraco.RichText' ? 'string' : 'unknown'
  }
}

/** Every property a type carries, including those from its compositions. */
export function effectiveProperties(
  set: SchemaSet,
  type: SchemaContentType,
  seen = new Set<string>(),
) {
  if (seen.has(type.alias)) return []
  seen.add(type.alias)
  const out = [...allProperties(type)]
  for (const alias of type.compositions) {
    // A built-in type such as `seoFields` has no file until a site extends it.
    const shipped = SYSTEM_CONTENT_TYPES.find((t) => t.alias === alias)
    const shippedMedia = BUILT_IN_MEDIA_TYPES.find((t) => t.alias === alias)
    const composed =
      set.contentTypes.find((t) => t.alias === alias) ??
      set.mediaTypes?.find((t) => t.alias === alias) ??
      (shipped ? builtInContentTypeSchema(shipped) : undefined) ??
      (shippedMedia ? builtInMediaTypeSchema(shippedMedia) : undefined)
    if (composed) out.push(...effectiveProperties(set, composed, seen))
  }
  return out
}

export function generateTypes(set: SchemaSet): string {
  const out: string[] = [
    '// Generated by `crombolo generate` from schema/*.toml. Do not edit.',
    '',
    'export interface ContentTypeProperties {',
  ]
  for (const t of [...set.contentTypes].sort((a, b) => a.alias.localeCompare(b.alias))) {
    out.push(`  ${JSON.stringify(t.alias)}: ${pascal(t.alias)}`)
  }
  out.push('}', '')
  out.push('export type ContentTypeAlias = keyof ContentTypeProperties', '')
  for (const t of [...set.contentTypes].sort((a, b) => a.alias.localeCompare(b.alias))) {
    out.push(`/** ${t.name}${t.description ? ` — ${t.description}` : ''} */`)
    out.push(`export interface ${pascal(t.alias)} {`)
    const properties = effectiveProperties(set, t)
    const byAlias = new Map(properties.map((p) => [p.alias, p]))
    for (const p of [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias))) {
      if (p.description) out.push(`  /** ${p.description} */`)
      out.push(`  ${JSON.stringify(p.alias)}${p.mandatory ? '' : '?'}: ${tsTypeFor(set, p.type)}`)
    }
    out.push('}', '')
  }
  // Import only the value types the generated interfaces use.
  const body = out.join('\n')
  const used = [
    'BlockGridItem',
    'BlockItem',
    'Link',
    'PublishedContent',
    'PublishedElement',
    'TypedElement',
  ].filter((name) => new RegExp(`\\b${name}\\b`).test(body.split('\n').slice(2).join('\n')))
  if (used.length > 0)
    out.splice(2, 0, `import type { ${used.join(', ')} } from '@crombolo/crombolo'`, '')
  return `${out.join('\n').trimEnd()}\n`
}
