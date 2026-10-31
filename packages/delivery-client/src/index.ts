/**
 * A typed client for a crombolo site's Delivery API (`/crombolo/delivery/api/v2`).
 * The shapes are the JSON the API writes; `crombolo generate --delivery` writes
 * a site's content types as a `DeliveryTypes` map to pass in as the generic.
 * docs/delivery-api.md, "Typed apps".
 *
 * One file and no dependencies, because it is built to plain JavaScript for apps
 * on any toolchain, unlike the rest of crombolo.
 */

/** Where a page lives: its path below its root, and the root itself. */
export interface ApiRoute {
  path: string
  queryString: string | null
  startItem: { id: string; path: string }
}

/** What a picker's target carries when it was not expanded. */
export type NotExpanded = Record<string, never>

export interface ApiContent<Alias extends string = string, Properties = Record<string, unknown>> {
  contentType: Alias
  name: string
  createDate: string
  updateDate: string
  route: ApiRoute
  id: string
  properties: Properties
}

/** A page as a picker or a link holds it: its properties are there only when expanded. */
export type ApiContentReference<
  Alias extends string = string,
  Properties = Record<string, unknown>,
> = ApiContent<Alias, Properties | NotExpanded>

/** A page as the item, items, query and search endpoints answer it. */
export interface ApiContentResponse<
  Alias extends string = string,
  Properties = Record<string, unknown>,
> extends ApiContent<Alias, Properties> {
  /** Its route in each culture; empty for a page that does not vary. */
  cultures: Record<string, ApiRoute>
  /** Search and sharing details, when asked for with `seo: true`. */
  seo?: ApiSeo
}

/** A block or picked element: its properties are always there. */
export interface ApiElement<Alias extends string = string, Properties = Record<string, unknown>> {
  contentType: Alias
  id: string
  name: string
  properties: Properties
}

export interface ApiFocalPoint {
  left: number
  top: number
}

export interface ApiCrop {
  alias: string
  width: number
  height: number
  coordinates: { x1: number; y1: number; x2: number; y2: number } | null
}

export interface ApiMedia<Alias extends string = string, Properties = Record<string, unknown>> {
  id: string
  name: string
  mediaType: Alias
  url: string
  extension: string | null
  width: number | null
  height: number | null
  bytes: number | null
  properties: Properties
}

/** Media as a picker holds it: its own properties are there only when expanded. */
export type ApiMediaReference<
  Alias extends string = string,
  Properties = Record<string, unknown>,
> = ApiMedia<Alias, Properties | NotExpanded>

/** Media picked with the media picker: its crops and focal point, the pick's own first. */
export type ApiMediaWithCrops<
  Alias extends string = string,
  Properties = Record<string, unknown>,
> = ApiMediaReference<Alias, Properties> & {
  focalPoint: ApiFocalPoint | null
  crops: ApiCrop[]
}

/** Media as the media item and query endpoints answer it. */
export type ApiMediaResponse<
  Alias extends string = string,
  Properties = Record<string, unknown>,
> = ApiMedia<Alias, Properties> & {
  /** Names from the root down, lower case, with a trailing slash. */
  path: string
  createDate: string
  updateDate: string
  focalPoint: ApiFocalPoint | null
  crops: ApiCrop[] | null
}

export interface ApiLink {
  url: string | null
  queryString: string | null
  title: string | null
  target: string | null
  destinationId: string | null
  destinationType: string | null
  route: ApiRoute | null
  linkType: 'Content' | 'Media' | 'External'
  culture: string | null
}

export interface ApiBlockListItem<Content = ApiElement, Settings = ApiElement> {
  content: Content | null
  settings: Settings | null
}

export interface ApiBlockList<Content = ApiElement, Settings = ApiElement> {
  items: ApiBlockListItem<Content, Settings>[]
}

export interface ApiBlockGridArea<Content = ApiElement, Settings = ApiElement> {
  alias: string
  rowSpan: number
  columnSpan: number
  items: ApiBlockGridItem<Content, Settings>[]
}

export interface ApiBlockGridItem<Content = ApiElement, Settings = ApiElement>
  extends ApiBlockListItem<Content, Settings> {
  rowSpan: number
  columnSpan: number
  areaGridColumns: number
  areas: ApiBlockGridArea<Content, Settings>[]
}

export interface ApiBlockGrid<Content = ApiElement, Settings = ApiElement> {
  gridColumns: number
  items: ApiBlockGridItem<Content, Settings>[]
}

/** Text in a rich-text tree. */
export interface RichTextTextElement {
  $type: 'RichTextTextElement'
  tag: '#text'
  text: string
}

/** A tag in a rich-text tree, its `data-*` attributes without their prefix. */
export interface RichTextGenericElement<
  Tag extends string = string,
  Attributes = RichTextAttributes,
> {
  $type: 'RichTextGenericElement'
  tag: Tag
  attributes: Attributes
  elements: RichTextElement[]
}

export type RichTextAttributes = Record<string, unknown>

/**
 * A link: to a page, with its `route` and no `href`; to media, with `href` its
 * URL; or anywhere else, with `href` as written. A local link to nothing has
 * neither.
 */
export interface RichTextLinkAttributes extends RichTextAttributes {
  href?: string
  target?: string
  title?: string
  destinationId?: string
  destinationType?: string
  linkType?: 'Content' | 'Media'
  route?: ApiRoute
}

/** An image; from the media library, `src` is its URL with the crop query kept. */
export interface RichTextImageAttributes extends RichTextAttributes {
  src?: string
  alt?: string
  width?: string
  height?: string
}

/** Where a block sits: `content-id` names its entry in the value's `blocks`. */
export interface RichTextBlockAttributes extends RichTextAttributes {
  'content-id': string
}

/** The tags whose attributes are known. */
export interface RichTextTags {
  a: RichTextGenericElement<'a', RichTextLinkAttributes>
  img: RichTextGenericElement<'img', RichTextImageAttributes>
  'umb-rte-block': RichTextGenericElement<'umb-rte-block', RichTextBlockAttributes>
  'umb-rte-block-inline': RichTextGenericElement<'umb-rte-block-inline', RichTextBlockAttributes>
}

export type RichTextBlockElement = RichTextTags['umb-rte-block' | 'umb-rte-block-inline']

/** Any element below the root. */
export type RichTextElement = RichTextGenericElement | RichTextTextElement

/**
 * A rich-text value: Umbraco's `RichTextOutputAsJson` tree, the only form the
 * Delivery API answers rich text in (story 216).
 */
export interface RichTextValue<Content = ApiElement, Settings = ApiElement> {
  tag: '#root'
  attributes: RichTextAttributes
  elements: RichTextElement[]
  blocks: ApiBlockListItem<Content, Settings>[]
}

/**
 * What `walkRichText` makes of each node, given what it made of the node's
 * children. A tag with no visitor of its own goes to `element`; a block to
 * `block` when there is one, with its entry in `blocks`.
 */
export interface RichTextVisitors<Result, Content = ApiElement, Settings = ApiElement> {
  text(node: RichTextTextElement): Result
  element(node: RichTextGenericElement, children: Result[]): Result
  block?(item: ApiBlockListItem<Content, Settings> | undefined, node: RichTextBlockElement): Result
  tags?: {
    [Tag in keyof RichTextTags]?: (node: RichTextTags[Tag], children: Result[]) => Result
  } & { [tag: string]: ((node: never, children: Result[]) => Result) | undefined }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  shy: '\u00ad',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  deg: '°',
  times: '×',
  divide: '÷',
  euro: '€',
  pound: '£',
}

/**
 * Text or an attribute from a rich-text tree as characters: the tree keeps
 * entities as the CMS stored them, as Umbraco's does. Unknown names are left.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole
    const code =
      name[1] === 'x' || name[1] === 'X'
        ? Number.parseInt(name.slice(2), 16)
        : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

const BLOCK_TAGS = new Set(['umb-rte-block', 'umb-rte-block-inline'])

/** A rich-text tree folded through `visitors`, children first: what each top-level node made. */
export function walkRichText<Result, Content = ApiElement, Settings = ApiElement>(
  tree: RichTextValue<Content, Settings>,
  visitors: RichTextVisitors<Result, Content, Settings>,
): Result[] {
  const blocks = new Map(
    tree.blocks.flatMap((item) => {
      const id = (item.content as { id?: unknown } | null)?.id
      return typeof id === 'string' ? [[id.toLowerCase(), item] as const] : []
    }),
  )
  const visit = (node: RichTextElement): Result => {
    if (node.tag === '#text') return visitors.text(node as RichTextTextElement)
    const element = node as RichTextGenericElement
    if (visitors.block && BLOCK_TAGS.has(element.tag)) {
      const block = element as RichTextBlockElement
      const id = String(block.attributes['content-id'] ?? '').toLowerCase()
      return visitors.block(blocks.get(id), block)
    }
    const children = element.elements.map(visit)
    const own = visitors.tags?.[element.tag] as
      | ((node: RichTextGenericElement, children: Result[]) => Result)
      | undefined
    return own ? own(element, children) : visitors.element(element, children)
  }
  return tree.elements.map(visit)
}

export interface ApiColor {
  value: string
  label: string
}

export interface ApiImageCropper {
  url: string | null
  focalPoint: ApiFocalPoint | null
  crops: ApiCrop[]
}

/** A site's types, as `crombolo generate --delivery` writes them: each alias's properties. */
export interface DeliverySchema {
  content: object
  media: object
  /** The aliases of the site's settings types (story 058), when it has any. */
  settings?: string
}

type Aliases<Map> = Extract<keyof Map, string>

/** The site's settings page: of its settings type when the schema names one, else any page. */
export type SettingsItem<Schema extends DeliverySchema = DeliverySchema> = Schema extends {
  settings: infer Alias extends Aliases<Schema['content']>
}
  ? ApiContentResponse<Alias, Schema['content'][Alias]>
  : ContentItem<Schema>

/** Any page the site serves, told apart by `contentType`. */
export type ContentItem<Schema extends DeliverySchema = DeliverySchema> =
  DeliverySchema extends Schema
    ? ApiContentResponse
    : {
        [Alias in Aliases<Schema['content']>]: ApiContentResponse<Alias, Schema['content'][Alias]>
      }[Aliases<Schema['content']>]

/** Any media item, told apart by `mediaType`. */
export type MediaItem<Schema extends DeliverySchema = DeliverySchema> =
  DeliverySchema extends Schema
    ? ApiMediaResponse
    : {
        [Alias in Aliases<Schema['media']>]: ApiMediaResponse<Alias, Schema['media'][Alias]>
      }[Aliases<Schema['media']>]

/** A search result: the page, how well it matched, and an excerpt with matches in `<mark>`. */
export type SearchHit<Schema extends DeliverySchema = DeliverySchema> = ContentItem<Schema> & {
  score: number
  /** HTML: everything escaped but the `<mark>` around each matching word. */
  excerpt: string
}

/** What the site answers at an address: a page, a redirect, or not found. */
export type RouteAnswer<Schema extends DeliverySchema = DeliverySchema> =
  | { kind: 'page'; culture: string | null; item: ContentItem<Schema> }
  | { kind: 'redirect'; location: string; statusCode: number; permanent: boolean }
  /** With the site's not-found page, when it has one. */
  | { kind: 'notFound'; item: ContentItem<Schema> | null }

/** A menu's entry: a page, media item, address or label, with the entries below it. */
export interface ApiMenuItem {
  label: string
  kind: 'page' | 'media' | 'external' | 'label'
  /** The page or media item it links to. */
  id: string | null
  /** An address for media and external links; a page has its `route` instead. */
  url: string | null
  route: ApiRoute | null
  target: string | null
  children: ApiMenuItem[]
}

export interface ApiMenu {
  alias: string
  items: ApiMenuItem[]
}

export interface Paged<Item> {
  total: number
  items: Item[]
}

/**
 * Whether a picker's target came back expanded. An expanded target carries every
 * property, empty ones as `null`; an unexpanded one carries none.
 */
export function isExpanded<Reference extends { properties: object }>(
  reference: Reference,
): reference is Reference & { properties: Exclude<Reference['properties'], NotExpanded> } {
  return Object.keys(reference.properties).length > 0
}

/** `fields` narrows the properties a response carries, so any may be missing. */
type Narrowed<Item> = Item extends { properties: infer Properties }
  ? Omit<Item, 'properties'> & { properties: Partial<Properties> }
  : Item

type Fielded<Item, Options> = Options extends { fields: string } ? Narrowed<Item> : Item

/** A page's search and sharing details, with `seo: true` (story 055). */
export interface ApiSeo {
  title: string
  description: string | null
  image: { url: string; width: number | null; height: number | null } | null
  canonical: string | null
  robots: string | null
  alternates: Array<{ culture: string; url: string }>
  xDefault: string | null
  siteName: string
}

/** One page `sitemap(host)` lists. */
export interface ApiSitemapItem {
  id: string
  url: string
  lastmod: string
  alternates: Array<{ culture: string; url: string }>
}

/** What a request learned, for a cache that tags what it keeps. */
export interface DeliveryAnswer {
  url: string
  status: number
  /** Every page and media key the answer holds, lower case. */
  keys: string[]
  /** The purge tags the site sent, when it sends them. */
  tags: string[]
  etag: string | null
  cacheControl: string | null
  /** The answer came from a kept copy after a `304`. */
  revalidated: boolean
}

/** Copies kept for `If-None-Match`, by address. */
export interface ConditionalStore {
  get(url: string): { etag: string; body: string } | undefined
  set(url: string, copy: { etag: string; body: string }): void
}

/** A store of the most recent `limit` copies, in memory. */
export function memoryConditionalStore(limit = 500): ConditionalStore {
  const copies = new Map<string, { etag: string; body: string }>()
  return {
    get(url) {
      const copy = copies.get(url)
      if (copy) {
        copies.delete(url)
        copies.set(url, copy)
      }
      return copy
    },
    set(url, copy) {
      copies.delete(url)
      copies.set(url, copy)
      while (copies.size > limit) copies.delete(copies.keys().next().value as string)
    },
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every page and media key in an answer, lower case: items, pickers, links, list entries. */
export function contentKeysIn(body: unknown): string[] {
  const keys = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const id = record.id
    if (
      typeof id === 'string' &&
      UUID.test(id) &&
      ('contentType' in record || 'mediaType' in record)
    )
      keys.add(id.toLowerCase())
    if (typeof record.destinationId === 'string' && UUID.test(record.destinationId))
      keys.add(record.destinationId.toLowerCase())
    for (const child of Object.values(record)) walk(child)
  }
  walk(body)
  return [...keys]
}

export interface RequestOptions {
  /** A culture name, such as `en-US`; otherwise the client's, then the site's default. */
  culture?: string
  /** A root's id or path, to resolve paths and queries under it. */
  startItem?: string
  /** Which pickers to expand: `properties[$all]`, `properties[related[properties[$all]]]`. */
  expand?: string
  /** Which properties to include: `properties[title,image]`. */
  fields?: string
  /** Adds each page's search and sharing details as `seo`. */
  seo?: boolean
  signal?: AbortSignal
}

export interface ContentQuery extends RequestOptions {
  /** `children:<id or path>`, `descendants:…` or `ancestors:…`; everything when left out. */
  fetch?: string
  /** `contentType:page`, `name:news`, `createDate>2026-01-01`; filters combine with AND. */
  filter?: string | string[]
  /** `name:asc`, `createDate:desc`, `sortOrder:asc`, `level:asc`, `updateDate:desc`. */
  sort?: string | string[]
  skip?: number
  take?: number
}

export interface MediaQuery extends Omit<RequestOptions, 'culture' | 'startItem'> {
  /** Required: `children:/` for the top level, or `children:<id or path>`. */
  fetch: string
  filter?: string | string[]
  sort?: string | string[]
  skip?: number
  take?: number
}

export interface SearchOptions {
  culture?: string
  /** Keep to these page types. */
  contentType?: string | string[]
  skip?: number
  /** At most 100. */
  take?: number
  signal?: AbortSignal
}

export interface DeliveryClientOptions {
  /** The site's address, such as `https://cms.example.com`. */
  baseUrl: string
  /**
   * The API's path on the site, `/crombolo/delivery/api/v2` unless given:
   * `/umbraco/delivery/api/v2` for a site from before the move (0.25 or older) or an Umbraco site.
   */
  apiPath?: string
  /** Sent as `Api-Key`, for a site whose API is not public. Keep it out of browser code. */
  apiKey?: string
  /** The culture every request asks for unless it names its own. */
  culture?: string
  /** The root every request resolves under unless it names its own. */
  startItem?: string
  /** A signed-in member's access token, for members-only pages. Asked for on every request. */
  memberToken?: () => string | undefined | Promise<string | undefined>
  /** Headers sent with every request. */
  headers?: Record<string, string>
  /**
   * Drafts instead of what is published (story 053): `Preview: true`, with the
   * editor's preview token when there is one. Asked for on every request.
   */
  preview?: () =>
    | boolean
    | { token?: string }
    | undefined
    | Promise<boolean | { token?: string } | undefined>
  /** Told about every answer: its keys and tags, for a cache to tag what it keeps. */
  onAnswer?: (answer: DeliveryAnswer) => void
  /** Keeps copies and revalidates them with `If-None-Match`; a `304` reuses the copy. */
  conditional?: ConditionalStore
  /** Where the site sends purge tags; `Surrogate-Key` and `Cache-Tag` are read when unset. */
  tagHeader?: string
  /** Defaults to the global `fetch`. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>
}

/** A refusal or failure from the API: its status, and its body when it had one. */
export class DeliveryError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, url: string) {
    super(`The Delivery API answered ${status} for ${url}`)
    this.name = 'DeliveryError'
    this.status = status
    this.body = body
  }
}

export interface DeliveryClient<Schema extends DeliverySchema = DeliverySchema> {
  /** One page by id or path; undefined when there is none. */
  item<Options extends RequestOptions>(
    idOrPath: string,
    options?: Options,
  ): Promise<Fielded<ContentItem<Schema>, Options> | undefined>
  /** Pages by id, in the order asked, leaving out any that do not exist. */
  items<Options extends RequestOptions>(
    ids: readonly string[],
    options?: Options,
  ): Promise<Fielded<ContentItem<Schema>, Options>[]>
  /** A page of pages, filtered and sorted. */
  content<Options extends ContentQuery>(
    query?: Options,
  ): Promise<Paged<Fielded<ContentItem<Schema>, Options>>>
  /** One media item by id or path; undefined when there is none. */
  mediaItem<Options extends RequestOptions>(
    idOrPath: string,
    options?: Options,
  ): Promise<Fielded<MediaItem<Schema>, Options> | undefined>
  mediaItems<Options extends RequestOptions>(
    ids: readonly string[],
    options?: Options,
  ): Promise<Fielded<MediaItem<Schema>, Options>[]>
  /** A page of media below a folder. */
  media<Options extends MediaQuery>(
    query: Options,
  ): Promise<Paged<Fielded<MediaItem<Schema>, Options>>>
  /** Published pages matching every word of the term, best first. */
  search(term: string, options?: SearchOptions): Promise<Paged<SearchHit<Schema>>>
  /** A menu by its alias, in the culture asked for; undefined when there is none. */
  menu(
    alias: string,
    options?: Pick<RequestOptions, 'culture' | 'signal'>,
  ): Promise<ApiMenu | undefined>
  /**
   * Every dictionary item in the culture asked for, as key to text, each falling
   * back as a template's `dictionary()` does; `keys` narrows it (story 058).
   */
  dictionary(
    keys?: readonly string[],
    options?: Pick<RequestOptions, 'culture' | 'signal'>,
  ): Promise<Record<string, string>>
  /**
   * The site's settings page, under `startItem`'s root or the first; undefined
   * when it has none (story 058).
   */
  settings<Options extends Omit<RequestOptions, 'seo'>>(
    options?: Options,
  ): Promise<Fielded<SettingsItem<Schema>, Options> | undefined>
  /**
   * What the site would answer at a visitor's address — the page, a redirect, or
   * not found — for an app's router. `host` picks the root and culture as the
   * site's domains do.
   */
  route(
    path: string,
    options?: Omit<RequestOptions, 'culture' | 'fields'> & { host?: string },
  ): Promise<RouteAnswer<Schema>>
  /** The pages `/sitemap.xml` lists for a hostname; undefined when the site serves none. */
  sitemap(
    host?: string,
    options?: Pick<RequestOptions, 'signal'>,
  ): Promise<Paged<ApiSitemapItem> | undefined>
  /** A form to draw, by key or alias (story 056); undefined when there is none. */
  form(
    keyOrAlias: string,
    options?: Pick<RequestOptions, 'culture' | 'signal'>,
  ): Promise<Record<string, unknown> | undefined>
}

/** Where a crombolo site serves it; Umbraco's own path, `/umbraco/delivery/api/v2`, answers too. */
export const DELIVERY_API_PATH = '/crombolo/delivery/api/v2'

const list = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/** A path of names, each segment escaped and the slashes kept. */
const itemPath = (idOrPath: string): string =>
  idOrPath
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

export function createDeliveryClient<Schema extends DeliverySchema = DeliverySchema>(
  options: DeliveryClientOptions,
): DeliveryClient<Schema> {
  const base = `${options.baseUrl.replace(/\/+$/, '')}${options.apiPath ?? DELIVERY_API_PATH}`
  const send = options.fetch ?? ((input, init) => fetch(input, init))

  async function get(
    path: string,
    params: Array<[string, string]>,
    request: { culture?: string; startItem?: string; signal?: AbortSignal },
    missing: 'undefined' | 'throw' | 'body',
  ): Promise<unknown> {
    const query = new URLSearchParams(params).toString()
    const url = `${base}/${path}${query ? `?${query}` : ''}`
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers }
    if (options.apiKey) headers['api-key'] = options.apiKey
    const culture = request.culture ?? options.culture
    if (culture) headers['accept-language'] = culture
    const startItem = request.startItem ?? options.startItem
    if (startItem) headers['start-item'] = startItem
    const token = await options.memberToken?.()
    if (token) headers.authorization = `Bearer ${token}`
    const preview = await options.preview?.()
    if (preview) {
      headers.preview = 'true'
      if (typeof preview === 'object' && preview.token) headers['preview-token'] = preview.token
    }
    // A member's or a preview's answer is theirs alone, so it is never kept.
    const keeps = options.conditional && !token && !preview ? options.conditional : undefined
    const kept = keeps?.get(url)
    if (kept) headers['if-none-match'] = kept.etag
    const response = await send(url, { headers, signal: request.signal })
    if (response.status === 404 && missing === 'undefined') return undefined
    const revalidated = response.status === 304 && kept !== undefined
    const text = revalidated ? kept.body : await response.text()
    const body = text ? (JSON.parse(text) as unknown) : null
    const etag = revalidated ? kept.etag : response.headers.get('etag')
    if (keeps && etag && response.ok && !revalidated) keeps.set(url, { etag, body: text })
    if (options.onAnswer) {
      const tagged =
        response.headers.get(options.tagHeader ?? 'surrogate-key') ??
        (options.tagHeader ? null : response.headers.get('cache-tag'))
      options.onAnswer({
        url,
        status: revalidated ? 200 : response.status,
        keys: contentKeysIn(body),
        tags: tagged ? tagged.split(/[\s,]+/).filter(Boolean) : [],
        etag,
        cacheControl: response.headers.get('cache-control'),
        revalidated,
      })
    }
    if (revalidated) return body
    if (response.status === 404 && missing === 'body') return body
    if (!response.ok) throw new DeliveryError(response.status, body, url)
    return body
  }

  const shaping = (request: RequestOptions): Array<[string, string]> => [
    ...(request.expand ? [['expand', request.expand] as [string, string]] : []),
    ...(request.fields ? [['fields', request.fields] as [string, string]] : []),
    ...(request.seo ? [['seo', 'true'] as [string, string]] : []),
  ]

  const paging = (query: {
    filter?: string | string[]
    sort?: string | string[]
    skip?: number
    take?: number
  }): Array<[string, string]> => [
    ...list(query.filter).map((filter): [string, string] => ['filter', filter]),
    ...list(query.sort).map((sort): [string, string] => ['sort', sort]),
    ...(query.skip !== undefined ? [['skip', String(query.skip)] as [string, string]] : []),
    ...(query.take !== undefined ? [['take', String(query.take)] as [string, string]] : []),
  ]

  const ids = (keys: readonly string[]) => keys.map((id): [string, string] => ['id', id])

  return {
    item: (idOrPath, request) =>
      get(
        `content/item/${itemPath(idOrPath)}`,
        shaping(request ?? {}),
        request ?? {},
        'undefined',
      ) as never,
    items: (keys, request) =>
      get(
        'content/items',
        [...ids(keys), ...shaping(request ?? {})],
        request ?? {},
        'throw',
      ) as never,
    content: (query) => {
      const q: ContentQuery = query ?? {}
      return get(
        'content',
        [...(q.fetch ? [['fetch', q.fetch] as [string, string]] : []), ...paging(q), ...shaping(q)],
        q,
        'throw',
      ) as never
    },
    mediaItem: (idOrPath, request) =>
      get(
        `media/item/${itemPath(idOrPath)}`,
        shaping(request ?? {}),
        request ?? {},
        'undefined',
      ) as never,
    mediaItems: (keys, request) =>
      get(
        'media/items',
        [...ids(keys), ...shaping(request ?? {})],
        request ?? {},
        'throw',
      ) as never,
    media: (query) =>
      get(
        'media',
        [['fetch', query.fetch], ...paging(query), ...shaping(query)],
        query,
        'throw',
      ) as never,
    menu: (alias, request = {}) =>
      get(`menus/${encodeURIComponent(alias)}`, [], request, 'undefined') as never,
    dictionary: (keys, request = {}) =>
      get(
        'dictionary',
        keys && keys.length > 0 ? [['keys', keys.join(',')]] : [],
        request,
        'body',
      ) as never,
    settings: (request) =>
      get('settings', shaping(request ?? {}), request ?? {}, 'undefined') as never,
    route: (path, request = {}) =>
      get(
        'route',
        [
          ['path', path],
          ...(request.host ? [['host', request.host] as [string, string]] : []),
          ...shaping(request),
        ],
        request,
        'body',
      ) as never,
    sitemap: (host, request = {}) =>
      get('sitemap', host ? [['host', host]] : [], request, 'undefined') as never,
    form: (keyOrAlias, request = {}) =>
      get(`forms/${encodeURIComponent(keyOrAlias)}`, [], request, 'undefined') as never,
    search: (term, search = {}) =>
      get(
        'search',
        [
          ['term', term],
          ...list(search.contentType).map((type): [string, string] => ['contentType', type]),
          ...paging(search),
        ],
        search,
        'throw',
      ) as never,
  }
}
