/**
 * `crombolo generate --delivery`: TypeScript for the JSON a site's Delivery API
 * writes, one properties interface per content, element and media type, typed
 * for `@crombolo/delivery-client`. docs/delivery-api.md, "Typed apps".
 *
 * A sibling of `generateTypes`, which types what a server-rendered view
 * receives; the two describe the same schema in two different shapes.
 */
import { BUILT_IN_MEDIA_TYPES } from '@crombolo/data'
import { storageTypeFor } from './builtin.ts'
import {
  blockElements,
  contentTypeAliasOf,
  dataTypeOf,
  effectiveProperties,
  pascal,
} from './generate.ts'
import type { SchemaContentType, SchemaSet } from './model.ts'

export interface DeliveryTypesOptions {
  /** Whether the API serves a content type: the site's allow and disallow lists. */
  serves?: (alias: string) => boolean
}

/** The module the generated file imports its shapes from. */
export const DELIVERY_CLIENT_MODULE = '@crombolo/delivery-client'

/** An alias as an object key: bare when it is an identifier, quoted otherwise. */
const key = (alias: string) => (/^[A-Za-z_$][\w$]*$/.test(alias) ? alias : `'${alias}'`)

const byAlias = (a: { alias: string }, b: { alias: string }) => a.alias.localeCompare(b.alias)

/** Types a config names, by key or alias, as a list or a comma-separated string (story 161). */
const keyAliases = (set: SchemaSet, keys: unknown): string[] =>
  (Array.isArray(keys) ? keys.map(String) : typeof keys === 'string' ? keys.split(',') : [])
    .map((key) => key.trim())
    .filter(Boolean)
    .flatMap((key) => contentTypeAliasOf(set, key) ?? [])

export function generateDeliveryTypes(set: SchemaSet, options: DeliveryTypesOptions = {}): string {
  const serves = options.serves ?? (() => true)
  const pages = set.contentTypes.filter((t) => !t.isElement && serves(t.alias)).sort(byAlias)
  const elements = set.contentTypes.filter((t) => t.isElement).sort(byAlias)
  const settingsTypes = pages.filter((t) => t.siteSettings)
  const media = mediaTypes(set)

  const name = (type: SchemaContentType) => `${pascal(type.alias)}Properties`
  const mediaName = (alias: string) => `${pascal(alias)}MediaProperties`
  const elementType = (alias: string) => {
    const type = elements.find((t) => t.alias === alias)
    return type ? `ApiElement<${JSON.stringify(alias)}, ${name(type)}>` : undefined
  }
  const elementUnion = (aliases: string[]) => {
    const types = aliases.flatMap((alias) => elementType(alias) ?? [])
    return types.length === 0 ? 'Element' : types.join(' | ')
  }
  const pageReferences = (aliases?: string[]) => {
    const chosen = aliases ? pages.filter((t) => aliases.includes(t.alias)) : pages
    return chosen.length === 0 || !aliases
      ? 'ContentReference'
      : chosen.map((t) => `ApiContentReference<${JSON.stringify(t.alias)}, ${name(t)}>`).join(' | ')
  }

  /** The JSON the Delivery API writes for a property of this data type; null when empty. */
  const typeFor = (dataTypeAlias: string): string => {
    const { editor, config, blocks } = dataTypeOf(set, dataTypeAlias)
    switch (editor) {
      case undefined:
        return 'unknown'
      case 'Umbraco.MemberPicker':
        return "'(unsupported)'"
      case 'Umbraco.TrueFalse':
        return 'boolean'
      case 'Umbraco.RichText':
        return 'RichTextValue'
      case 'Umbraco.ContentPicker':
        return 'ContentReference'
      case 'Umbraco.MultiNodeTreePicker': {
        const startNode = config.startNode as { type?: unknown } | undefined
        const filter = typeof config.filter === 'string' ? config.filter : ''
        const aliases = filter
          .split(',')
          .map((alias) => alias.trim())
          .filter(Boolean)
        const content = pageReferences(aliases.length ? aliases : undefined)
        if (startNode?.type === 'media') return 'MediaReference[]'
        if (startNode?.type === 'content') return `Array<${content}>`
        return `Array<${content} | MediaReference>`
      }
      case 'Umbraco.MediaPicker3':
        return 'Array<MediaWithCrops>'
      case 'Umbraco.MultiUrlPicker':
        return 'ApiLink[]'
      case 'Umbraco.BlockList': {
        const { content, settings } = blockElements(set, config, blocks)
        return `ApiBlockList<${elementUnion(content)}, ${elementUnion(settings)}>`
      }
      case 'Umbraco.BlockGrid': {
        const { content, settings } = blockElements(set, config, blocks)
        return `ApiBlockGrid<${elementUnion(content)}, ${elementUnion(settings)}>`
      }
      case 'Umbraco.ElementPicker': {
        return `Array<${elementUnion([...new Set(keyAliases(set, config.allowedContentTypes))])}>`
      }
      case 'Umbraco.DropDown.Flexible':
        return config.multiple === true ? 'string[]' : 'string'
      case 'Umbraco.CheckBoxList':
      case 'Umbraco.MultipleTextstring':
      case 'Umbraco.Tags':
        return 'string[]'
      case 'Umbraco.DateTime':
        return 'string'
      case 'Umbraco.ColorPicker':
        return 'ApiColor'
      case 'Umbraco.ImageCropper':
        return 'ApiImageCropper'
      case 'Umbraco.UploadField':
      case 'Umbraco.TextBox':
      case 'Umbraco.TextArea':
      case 'Umbraco.EmailAddress':
        return 'string'
    }
    switch (storageTypeFor(editor)) {
      case 'Integer':
      case 'Decimal':
        return 'number'
      case 'Date':
      case 'Nvarchar':
        return 'string'
      default:
        return 'unknown'
    }
  }

  const body = (
    properties: ReturnType<typeof effectiveProperties>,
    skip?: (alias: string) => boolean,
  ) => {
    const lines: string[] = []
    const unique = new Map(properties.map((p) => [p.alias, p]))
    for (const p of [...unique.values()].sort(byAlias)) {
      if (skip?.(p.alias)) continue
      if (p.description) lines.push(`  /** ${p.description} */`)
      lines.push(`  ${key(p.alias)}: ${typeFor(p.type)} | null`)
    }
    return lines
  }

  const out: string[] = [
    '// Generated by `crombolo generate --delivery` from schema/*.toml. Do not edit.',
    '',
    '',
    '/** Every type the Delivery API serves, by alias: pass it to `createDeliveryClient`. */',
    'export interface DeliveryTypes {',
    '  content: {',
    ...pages.map((t) => `    ${key(t.alias)}: ${name(t)}`),
    '  }',
    '  elements: {',
    ...elements.map((t) => `    ${key(t.alias)}: ${name(t)}`),
    '  }',
    '  media: {',
    ...media.map((t) => `    ${key(t.alias)}: ${mediaName(t.alias)}`),
    '  }',
    ...(settingsTypes.length > 0
      ? [`  settings: ${settingsTypes.map((t) => `'${t.alias}'`).join(' | ')}`]
      : []),
    '}',
    '',
    '/** Any page, as the item, query and search endpoints answer it. */',
    'export type Content = ContentItem<DeliveryTypes>',
    '',
    '/** Any media item, as the media endpoints answer it. */',
    'export type Media = MediaItem<DeliveryTypes>',
    '',
    '/** A page a picker or link holds; its properties are there only when expanded. */',
    `export type ContentReference = ${
      pages.length === 0
        ? 'ApiContentReference'
        : pages
            .map((t) => `ApiContentReference<${JSON.stringify(t.alias)}, ${name(t)}>`)
            .join(' | ')
    }`,
    '',
    '/** Media a picker holds; its own properties are there only when expanded. */',
    `export type MediaReference = ${media
      .map((t) => `ApiMediaReference<${JSON.stringify(t.alias)}, ${mediaName(t.alias)}>`)
      .join(' | ')}`,
    '',
    '/** Media picked with the media picker, with its crops. */',
    `export type MediaWithCrops = ${media
      .map((t) => `ApiMediaWithCrops<${JSON.stringify(t.alias)}, ${mediaName(t.alias)}>`)
      .join(' | ')}`,
    '',
    '/** Any element, as a block or an element picker holds it. */',
    `export type Element = ${
      elements.length === 0
        ? 'ApiElement'
        : elements.map((t) => `ApiElement<${JSON.stringify(t.alias)}, ${name(t)}>`).join(' | ')
    }`,
    '',
  ]
  for (const type of [...pages, ...elements]) {
    out.push(`/** ${type.name}${type.description ? ` — ${type.description}` : ''} */`)
    out.push(`export interface ${name(type)} {`, ...body(effectiveProperties(set, type)), '}', '')
  }
  for (const type of media) {
    out.push(`/** ${type.name} (media) */`)
    out.push(
      `export interface ${mediaName(type.alias)} {`,
      ...body(type.properties, (alias) => alias.toLowerCase().startsWith('umbraco')),
      '}',
      '',
    )
  }

  const text = out.join('\n')
  const shapes = [
    'ApiBlockGrid',
    'ApiBlockList',
    'ApiColor',
    'ApiContentReference',
    'ApiElement',
    'ApiImageCropper',
    'ApiLink',
    'ApiMediaReference',
    'ApiMediaWithCrops',
    'ContentItem',
    'MediaItem',
    'RichTextValue',
  ].filter((shape) => new RegExp(`\\b${shape}\\b`).test(text))
  out[2] = `import type { ${shapes.join(', ')} } from '${DELIVERY_CLIENT_MODULE}'\n`
  return `${out.join('\n').trimEnd()}\n`
}

/** The site's media types, and the built-in ones it has no file for. */
function mediaTypes(set: SchemaSet): Array<{
  alias: string
  name: string
  properties: ReturnType<typeof effectiveProperties>
}> {
  const own = (set.mediaTypes ?? []).map((t) => ({
    alias: t.alias,
    name: t.name,
    properties: effectiveProperties(set, t),
  }))
  const builtIn = BUILT_IN_MEDIA_TYPES.filter(
    (b) => !b.composition && !own.some((t) => t.alias === b.alias),
  ).map((b) => ({ alias: b.alias, name: b.name, properties: [] }))
  return [...own, ...builtIn].sort(byAlias)
}
