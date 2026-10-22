/**
 * A typed client for a crombolo site's Delivery API (`/umbraco/delivery/api/v2`).
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

/** Rich text: its markup, with links already this site's URLs. */
export interface ApiRichText {
  markup: string
  blocks: unknown[]
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
}

type Aliases<Map> = Extract<keyof Map, string>

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

export interface RequestOptions {
  /** A culture name, such as `en-US`; otherwise the client's, then the site's default. */
  culture?: string
  /** A root's id or path, to resolve paths and queries under it. */
  startItem?: string
  /** Which pickers to expand: `properties[$all]`, `properties[related[properties[$all]]]`. */
  expand?: string
  /** Which properties to include: `properties[title,image]`. */
  fields?: string
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
  /**
   * What the site would answer at a visitor's address — the page, a redirect, or
   * not found — for an app's router. `host` picks the root and culture as the
   * site's domains do.
   */
  /** A menu by its alias, in the culture asked for; undefined when there is none. */
  menu(
    alias: string,
    options?: Pick<RequestOptions, 'culture' | 'signal'>,
  ): Promise<ApiMenu | undefined>
  route(
    path: string,
    options?: Omit<RequestOptions, 'culture' | 'fields'> & { host?: string },
  ): Promise<RouteAnswer<Schema>>
}

const API_PATH = '/umbraco/delivery/api/v2'

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
  const base = `${options.baseUrl.replace(/\/+$/, '')}${API_PATH}`
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
    const response = await send(url, { headers, signal: request.signal })
    if (response.status === 404 && missing === 'undefined') return undefined
    const text = await response.text()
    const body = text ? (JSON.parse(text) as unknown) : null
    if (response.status === 404 && missing === 'body') return body
    if (!response.ok) throw new DeliveryError(response.status, body, url)
    return body
  }

  const shaping = (request: RequestOptions): Array<[string, string]> => [
    ...(request.expand ? [['expand', request.expand] as [string, string]] : []),
    ...(request.fields ? [['fields', request.fields] as [string, string]] : []),
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
