/**
 * What templates get for structured property values: Umbraco's published value
 * converters. A picker yields the content it points at, a link picker yields
 * links with their URLs resolved, and block editors yield element models with
 * the same `value()` API as a page.
 */
import { keyFromReference, type SchemaForm } from '@crombolo/core'
import { RawHtml } from './html.ts'
import { ImageCropperValue, MediaWithCrops, PublishedMedia } from './media.ts'
import type { PublishedProperty } from './model.ts'

/** What conversion needs from the published cache. */
export interface ValueContext<Content = unknown, Media = unknown> {
  content(key: string): Content | undefined
  /**
   * A form definition by key. Absent until the renderer is given one, which is
   * what makes a `formPicker` resolve to the form rather than to its key.
   */
  form?(key: string): SchemaForm | undefined
  /**
   * A media item by key, looked up in the media cache (story 197); absent where
   * nothing resolves media. Lookups made together go to the database as one.
   */
  media?(key: string): Promise<Media | undefined>
  /** A published library element by key; absent until the cache knows them. */
  element?(key: string): PublishedElement | undefined
  /** A content type's alias by key, which is all a block records of its element type. */
  contentTypeAlias?(key: string): string | undefined
  /** A content URL, for links. */
  urlOf(content: Content): string
  mediaUrlOf?(media: Media): string
}

export interface Link {
  name: string
  url: string
  target: string | null
  type: 'document' | 'media' | 'external'
  /** The linked item's key; null for an external link. */
  key: string | null
}

export interface BlockItem {
  contentKey: string
  content: PublishedElement
  settingsKey: string | null
  settings: PublishedElement | null
}

export interface BlockGridArea {
  key: string
  /** The area's alias from the data type, when its block type still declares it. */
  alias: string | null
  columnSpan: number | null
  rowSpan: number | null
  items: BlockGridItem[]
}

export interface BlockGridItem extends BlockItem {
  columnSpan: number | null
  rowSpan: number | null
  /** The columns this block's areas lay out in; the grid's own when its block type says none. */
  areaGridColumns: number | null
  areas: BlockGridArea[]
}

/** A Block Grid's items, carrying the grid's column count for its markup. */
export type BlockGridValue = BlockGridItem[] & { gridColumns: number }

const references = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap((v) => (typeof v === 'string' ? [v] : []))
  if (typeof value === 'string')
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

/** One block's content or settings: an element with properties, but no URL or place in the tree. */
export class PublishedElement {
  readonly key: string
  readonly contentType: { key: string; alias: string | null }
  readonly properties: PublishedProperty[]
  #context: ValueContext | undefined

  constructor(
    init: {
      key: string
      contentTypeKey: string
      contentTypeAlias?: string | null
      properties: PublishedProperty[]
    },
    context?: ValueContext,
  ) {
    this.key = init.key
    this.contentType = { key: init.contentTypeKey, alias: init.contentTypeAlias ?? null }
    this.properties = init.properties
    this.#context = context
  }

  /** A media picker's, multi-node tree picker's or multi URL picker's value is a promise. */
  value(alias: string): unknown {
    const property = this.properties.find((p) => p.alias === alias)
    if (!property) return null
    return convertValue(property.editorAlias, property.value, this.#context, property.config)
  }

  /** A media picker's picks as a list, whether the picker allows one or many. */
  async media(alias: string): Promise<MediaWithCrops[]> {
    return picksOf(await this.value(alias))
  }

  /** `value()` as a string, read now: a rich text's media links that need looking up are `#`. */
  text(alias: string): string {
    const property = this.properties.find((p) => p.alias === alias)
    if (!property) return ''
    return textOf(convertValueNow(property.editorAlias, property.value, this.#context))
  }

  /** A rich-text value, marked so the renderer does not escape it; a promise when it links to media. */
  html(alias: string): RawHtml | Promise<RawHtml> {
    return htmlOf(this.value(alias))
  }
}

/** Whether a value is still being read. */
export const isPending = (value: unknown): value is Promise<unknown> =>
  value instanceof Promise ||
  (typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function')

/** A value as text; a pending one, which `text()` cannot wait for, is empty. */
export const textOf = (value: unknown): string =>
  value === null || value === undefined || isPending(value) ? '' : String(value)

/** A value as markup, waiting for it first when it is still being read. */
export function htmlOf(value: unknown): RawHtml | Promise<RawHtml> {
  if (!isPending(value)) return new RawHtml(textOf(value))
  return Promise.resolve(value).then((resolved) => new RawHtml(textOf(resolved)))
}

/** A media picker's value as a list of picks. */
export function picksOf(value: unknown): MediaWithCrops[] {
  if (Array.isArray(value))
    return value.filter((v): v is MediaWithCrops => v instanceof MediaWithCrops)
  return value instanceof MediaWithCrops ? [value] : []
}

/** An element whose `value()` knows its properties, as `crombolo generate` types block content. */
export interface TypedElement<Properties> extends PublishedElement {
  value<Alias extends keyof Properties & string>(alias: Alias): Properties[Alias]
}

interface BlockData {
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

interface BlockLayout {
  contentKey?: string
  settingsKey?: string | null
  columnSpan?: number
  rowSpan?: number
  areas?: Array<{ key: string; items?: BlockLayout[] }>
}

interface BlockValue {
  layout?: Record<string, BlockLayout[] | undefined>
  contentData?: BlockData[]
  settingsData?: BlockData[]
}

function elementFrom(data: BlockData | undefined, context?: ValueContext): PublishedElement | null {
  if (!data) return null
  return new PublishedElement(
    {
      key: data.key,
      contentTypeKey: data.contentTypeKey,
      contentTypeAlias: context?.contentTypeAlias?.(data.contentTypeKey) ?? null,
      properties: (data.values ?? []).map((v) => ({
        alias: v.alias,
        editorAlias: v.editorAlias ?? '',
        culture: v.culture ?? null,
        segment: v.segment ?? null,
        value: v.value,
      })),
    },
    context,
  )
}

interface GridBlockConfig {
  contentElementTypeKey?: string
  areaGridColumns?: unknown
  areas?: Array<{ key?: string; alias?: unknown; columnSpan?: unknown; rowSpan?: unknown }>
}

function blockItems<T extends BlockItem>(
  value: unknown,
  layoutAlias: string,
  context: ValueContext | undefined,
  extend: (layout: BlockLayout, item: BlockItem, build: (layouts: BlockLayout[]) => T[]) => T,
): T[] {
  if (!value || typeof value !== 'object') return []
  const block = value as BlockValue
  const contents = new Map((block.contentData ?? []).map((d) => [d.key, d]))
  const settings = new Map((block.settingsData ?? []).map((d) => [d.key, d]))
  const build = (layouts: BlockLayout[]): T[] =>
    layouts.flatMap((layout) => {
      const content = elementFrom(contents.get(layout.contentKey ?? ''), context)
      if (!content) return []
      const item: BlockItem = {
        contentKey: content.key,
        content,
        settingsKey: layout.settingsKey ?? null,
        settings: elementFrom(settings.get(layout.settingsKey ?? ''), context),
      }
      return [extend(layout, item, build)]
    })
  return build(block.layout?.[layoutAlias] ?? [])
}

/**
 * Schemes a link picked in the backoffice may use on the front end.
 *
 * A link's URL is typed by an editor and ends up in an `href`, where escaping
 * does nothing about the scheme: `javascript:` there runs for every visitor.
 * Relative and fragment URLs have no scheme and are left alone.
 */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ftp:'])

function safeExternalUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed === '') return ''
  // No scheme: a path, a fragment or a protocol-relative URL, none of which can
  // carry script. `new URL` needs a base to judge those, so they are let through
  // without one rather than guessed at.
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)) return trimmed
  try {
    return SAFE_LINK_SCHEMES.has(new URL(trimmed).protocol) ? trimmed : ''
  } catch {
    return ''
  }
}

const LOCAL_LINK = /\/?(?:\{|%7B)localLink:(?:umb:\/\/[a-z-]+\/)?([0-9a-fA-F-]{32,36})(?:\}|%7D)/g

/**
 * Rich text links to pages and media are stored as `/{localLink:<key>}`, so a
 * move or rename never breaks them; they become URLs when rendered. A link to
 * something unpublished or gone becomes `#`. Pages resolve at once; a link to
 * media is looked up in the media cache, so markup with one is a promise.
 */
export function resolveLocalLinks(
  markup: string,
  context?: ValueContext,
): string | Promise<string> {
  const pageUrl = (key: string | undefined) => {
    if (!key || !context) return undefined
    const content = context.content(key)
    return content ? context.urlOf(content) : undefined
  }
  const media = new Set<string>()
  for (const match of markup.matchAll(LOCAL_LINK)) {
    const key = keyFromReference(match[1] as string)
    if (key && context?.media && pageUrl(key) === undefined) media.add(key)
  }
  if (media.size === 0) return replaceLinks(markup, (key) => pageUrl(key) ?? '#')
  return Promise.all(
    [...media].map(async (key) => [key, await context?.media?.(key)] as const),
  ).then((found) => {
    const urls = new Map(
      found.flatMap(([key, item]) =>
        item && context?.mediaUrlOf ? [[key, context.mediaUrlOf(item)] as const] : [],
      ),
    )
    return replaceLinks(markup, (key) => pageUrl(key) ?? (key ? urls.get(key) : undefined) ?? '#')
  })
}

function replaceLinks(markup: string, urlOf: (key: string | undefined) => string): string {
  return markup.replace(LOCAL_LINK, (_, reference: string) => urlOf(keyFromReference(reference)))
}

/**
 * A value as `text()` reads it, without waiting: rich text with its page links
 * resolved and any media link `#`, and nothing for a value only a lookup gives.
 */
export function convertValueNow(
  editorAlias: string,
  value: unknown,
  context?: ValueContext,
  config: Record<string, unknown> = {},
): unknown {
  if (value === null || value === undefined) return value
  if (editorAlias === 'Umbraco.RichText') {
    if (typeof value !== 'string') return value
    const { media: _, ...pagesOnly } = context ?? ({} as ValueContext)
    return resolveLocalLinks(value, context ? (pagesOnly as ValueContext) : undefined)
  }
  if (ASYNC_EDITORS.has(editorAlias)) return null
  return convertValue(editorAlias, value, context, config)
}

/** The editors whose values are read asynchronously, because they can name media (story 197). */
export const ASYNC_EDITORS: ReadonlySet<string> = new Set([
  'Umbraco.MediaPicker3',
  'Umbraco.MultiNodeTreePicker',
  'Umbraco.MultiUrlPicker',
])

/** A stored (editor-shaped) value as a template receives it. */
export function convertValue(
  editorAlias: string,
  value: unknown,
  context?: ValueContext,
  config: Record<string, unknown> = {},
): unknown {
  if (value === null || value === undefined) return value
  switch (editorAlias) {
    case 'Umbraco.MediaPicker3':
      return Promise.all(
        (Array.isArray(value) ? value : []).map(async (raw) => {
          const pick = raw as Record<string, unknown>
          const key = keyFromReference(pick.mediaKey)
          const media = key ? await context?.media?.(key) : undefined
          return media instanceof PublishedMedia ? new MediaWithCrops(media, pick) : undefined
        }),
      ).then((found) => {
        const picks = found.filter((pick): pick is MediaWithCrops => pick !== undefined)
        return config.multiple === false ? (picks[0] ?? null) : picks
      })
    case 'Umbraco.RichText':
      return typeof value === 'string' ? resolveLocalLinks(value, context) : value
    case 'Umbraco.ImageCropper':
      return typeof value === 'object' || typeof value === 'string'
        ? new ImageCropperValue(typeof value === 'string' ? { src: value } : (value as object))
        : value
    // A form definition is a file, so there is nothing in the content cache to
    // resolve against: the lookup reads `schema/forms/`. Without one the raw key
    // comes back, which is what a unit test sees.
    case 'Crombolo.FormPicker': {
      const key = typeof value === 'string' ? value.trim() : ''
      if (!key) return null
      return context?.form?.(key) ?? null
    }
    case 'Umbraco.ContentPicker': {
      const key = keyFromReference(value)
      return (key && context?.content(key)) ?? null
    }
    /**
     * The Library's own picker. Umbraco stores a bare `Guid[]` here rather than the
     * `umb://…` references a content picker stores, and always yields a collection
     * even where the configuration allows one pick — so a template writes `[0]` for
     * a single. An element the culture cannot see is simply absent from this
     * culture's view, which is the drop Umbraco's converter does explicitly.
     */
    case 'Umbraco.ElementPicker':
      return references(value).flatMap((reference) => {
        const key = keyFromReference(reference)
        const found = key ? context?.element?.(key) : undefined
        return found ? [found] : []
      })
    case 'Umbraco.MultiNodeTreePicker':
      return Promise.all(
        references(value).map(async (reference) => {
          const key = keyFromReference(reference)
          if (!key) return undefined
          return context?.content(key) ?? (await context?.media?.(key))
        }),
      ).then((found) => found.filter((item) => item !== undefined && item !== null))
    case 'Umbraco.MultiUrlPicker':
      return Promise.all(
        (Array.isArray(value) ? value : []).map(async (raw): Promise<Link | undefined> => {
          const link = raw as Record<string, unknown>
          const key = keyFromReference(link.unique ?? link.udi)
          const type = link.type === 'media' ? 'media' : key ? 'document' : 'external'
          const queryString = typeof link.queryString === 'string' ? link.queryString : ''
          let url: string | undefined
          if (type === 'document' && key) {
            const content = context?.content(key)
            if (!content) return undefined
            url = context?.urlOf(content)
          } else if (type === 'media' && key) {
            const media = await context?.media?.(key)
            if (!media) return undefined
            url = context?.mediaUrlOf?.(media)
          } else url = safeExternalUrl(typeof link.url === 'string' ? link.url : '')
          return {
            name: typeof link.name === 'string' ? link.name : '',
            url: `${url ?? ''}${queryString}`,
            target: typeof link.target === 'string' && link.target ? link.target : null,
            type,
            key: key ?? null,
          }
        }),
      ).then((links) => links.filter((link): link is Link => link !== undefined))
    case 'Umbraco.BlockList':
      return blockItems<BlockItem>(value, 'Umbraco.BlockList', context, (_, item) => item)
    case 'Umbraco.BlockGrid': {
      // What the data type says of each block type's areas: their aliases and spans.
      const blockTypes = Array.isArray(config.blocks) ? (config.blocks as GridBlockConfig[]) : []
      const typeOf = (key: string | undefined) =>
        blockTypes.find(
          (b) => String(b.contentElementTypeKey ?? '').toLowerCase() === (key ?? '').toLowerCase(),
        )
      const number = (value: unknown) => (typeof value === 'number' ? value : null)
      const items = blockItems<BlockGridItem>(
        value,
        'Umbraco.BlockGrid',
        context,
        (layout, item, build) => {
          const type = typeOf(item.content.contentType.key)
          return {
            ...item,
            columnSpan: layout.columnSpan ?? null,
            rowSpan: layout.rowSpan ?? null,
            areaGridColumns: number(type?.areaGridColumns),
            areas: (layout.areas ?? []).map((area) => {
              const declared = type?.areas?.find(
                (a) => String(a.key ?? '').toLowerCase() === area.key.toLowerCase(),
              )
              return {
                key: area.key,
                alias: typeof declared?.alias === 'string' ? declared.alias : null,
                columnSpan: number(declared?.columnSpan),
                rowSpan: number(declared?.rowSpan),
                items: build(area.items ?? []),
              }
            }),
          }
        },
      )
      return Object.assign(items, { gridColumns: Number(config.gridColumns) || 12 })
    }
    default:
      return value
  }
}
