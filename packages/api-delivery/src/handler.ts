/**
 * Umbraco's Delivery API v2 over the published cache: content and media
 * items, paths and queries, with its access, culture and Start-Item rules.
 * Every answer is read from memory, so it scales with the nodes that render.
 * docs/delivery-api.md.
 */
import { branchAccess, type MediaMember, type MediaRule, type SchemaForm } from '@crombolo/core'
import type {
  PublishedCache,
  PublishedContent,
  PublishedMedia,
  SearchableText,
} from '@crombolo/render'
import {
  type Cacheable,
  type CacheSettings,
  cacheable,
  excerpt,
  excerptHtml,
  isRightToLeft,
  lifetimeFor,
  type MenuItem,
  PRIVATE_NO_STORE,
  resolveCacheSettings,
  shortest,
} from '@crombolo/render'
import { corsPolicy, isPreflight, preflightResponse, withCors } from './cors.ts'
import {
  ALL_FIELDS,
  type ExpansionNode,
  ExpansionSyntaxError,
  parseExpansion,
} from './expansion.ts'
import {
  type ApiRoute,
  apiContentResponse,
  apiMediaResponse,
  type OutputContext,
} from './output.ts'
import { accessTo, type DeliveryMember, mediaAccessTo, type ProtectionRule } from './protection.ts'
import {
  compareBy,
  parseContentFilters,
  parseContentSelector,
  parseContentSorts,
  parseMediaQuery,
  passesFilters,
  QUERY_ERRORS,
  type QueryError,
  type Sort,
} from './query.ts'
import {
  type DeliveryApiSettings,
  isAllowedContentType,
  memberAuthorizationEnabled,
} from './settings.ts'

export interface DeliveryApiPorts {
  settings: DeliveryApiSettings
  cache: PublishedCache
  /** Where the API answers: `/umbraco/delivery/api`, as in Umbraco. */
  prefix: string
  /** Every protected node and who may see it; read once a request, and only when needed. */
  protection(): Promise<ProtectionRule[]>
  /** The member an access token names; undefined for none, or one not valid now. */
  member(token: string): Promise<DeliveryMember | undefined>
  /** Every media rule (story 196): few, one per folder given permissions, read once a request. */
  mediaRules?(): Promise<MediaRule[]>
  /**
   * The media library a page at a time, from the database (story 197); the
   * media endpoints answer nothing without it.
   */
  media?: DeliveryMediaPort
  /**
   * Drafts for a `Preview: true` request (story 053): given whether it carries
   * the API key, the draft cache and, for a preview token, which pages its
   * editor may read; undefined when the request may not preview.
   */
  preview?(request: Request, keyed: boolean): Promise<PreviewAccess | undefined>
  /** How long answers may be kept (story 057); nothing is kept when absent. */
  caching?: CacheSettings
  /**
   * A page's search and sharing details, worked out as `<SeoHead>` works them
   * out, for `seo=true` (story 055).
   */
  seo?(content: PublishedContent, request: Request): Promise<Record<string, unknown>>
  /** The sitemap's pages for a hostname; undefined when the site serves no sitemap (story 055). */
  sitemap?(request: Request, host: string): Promise<unknown[] | undefined>
  /**
   * Forms as data (story 056): a definition by key or alias, and, for one
   * request in one culture, how to draw any form as `v2/forms/{key}` answers it.
   */
  forms?: {
    byKey(key: string): SchemaForm | undefined
    shaper(
      culture: string | null,
      request: Request,
    ): Promise<(form: SchemaForm) => Record<string, unknown>>
  }
  /** The page the site shows for an address nothing answers, if it has one (story 054). */
  notFound?(
    host: string,
    path: string,
  ): Promise<{ key: string; culture: string | null } | undefined>
  /** The member sign-in endpoints under `v1/security/member/`, when built. */
  security?(request: Request, action: string): Promise<Response | undefined>
  /**
   * Site search over published pages (story 140), behind `v2/search`: a
   * Crombolo addition, which Umbraco's Delivery API has no equivalent of.
   */
  search?(
    term: string,
    options: {
      culture: string
      types: readonly string[]
      skip: number
      take: number
      access: { denied: readonly number[]; allowed: readonly number[] }
    },
  ): Promise<{ total: number; items: Array<{ key: string; score: number; text: SearchableText }> }>
}

/** The media tree as the media endpoints read it: by key, by path, and a page of children. */
export interface DeliveryMediaPort {
  /** Items by key, in the order asked; one gone or in the recycle bin is left out. */
  byKeys(keys: readonly string[]): Promise<PublishedMedia[]>
  /** The item at a path of names below the top level, matched in any case. */
  byPath(path: string): Promise<PublishedMedia | undefined>
  /**
   * A page of a parent's children: those passing every filter and readable by
   * `member`, in `sort` order and then Umbraco's (sort order, then id), with
   * how many there are in all.
   */
  children(
    parent: PublishedMedia | 'root',
    query: {
      filters: ReadonlyArray<{ kind: 'mediaType' | 'name'; value: string }>
      sort: Sort | undefined
      skip: number
      take: number
      readable: { rules: ReadonlyMap<number, MediaRule>; member: MediaMember | undefined }
    },
  ): Promise<{ total: number; items: PublishedMedia[] }>
  /** Each item's path of lowercased names, `/folder/item/`, by id. */
  paths(items: readonly PublishedMedia[]): Promise<Map<number, string>>
}

export interface PreviewAccess {
  /** Every page as last saved. */
  cache: PublishedCache
  /** For an editor's preview token: whether a page, by its ancestors' keys then its own, may be read. */
  mayRead?(chain: readonly string[]): boolean
}

export interface DeliveryApi {
  handle(request: Request): Promise<Response | undefined>
  /** Configured cross-origin settings that were ignored, said once at boot. */
  problems: string[]
}

/**
 * The methods a cross-origin caller may send to a path, or none for a path a
 * browser reaches by navigating (sign-in and sign-out) or that is not the API's. Pure.
 */
export function corsMethodsFor(rest: string): string | undefined {
  if (
    /^v2\/(content|media|search|route|sitemap|forms|menus|dictionary|settings)(\/.*)?$/.test(rest)
  )
    return 'GET, HEAD'
  const security = /^v1\/security\/member\/([^/]+)\/?$/.exec(rest)?.[1]
  if (security === 'token' || security === 'revoke') return 'POST'
  if (security === 'userinfo') return 'GET, POST'
  return undefined
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROOT_KEY = '00000000-0000-0000-0000-000000000000'
const PREVIEW_PATH = /^preview-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
/** The purge tag every dictionary answer carries: any change to it changes them all. */
export const DICTIONARY_TAG = 'crombolo-dictionary'
const CONTENT_VARY = 'Accept-Language, Accept-Segment, Preview, Start-Item'

/** 401, 403 and 404 carry no body in Umbraco's Delivery API. */
const bare = (status: number) => new Response(null, { status })

const problem = (error: QueryError) =>
  Response.json(
    {
      type: 'Error',
      title: QUERY_ERRORS[error].title,
      status: 400,
      detail: QUERY_ERRORS[error].detail,
    },
    { status: 400, headers: { 'content-type': 'application/problem+json' } },
  )

const invalid = (field: string, value: string) =>
  Response.json(
    {
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { [field]: [`The value '${value}' is not valid.`] },
    },
    { status: 400, headers: { 'content-type': 'application/problem+json' } },
  )

/**
 * Whether an answer depends on who asked: a member's token, or an API that is
 * not public, whose answers are for the key's holder. Pure.
 */
export function personal(request: Request, isPublic: boolean, membersSignIn: boolean): boolean {
  return !isPublic || (membersSignIn && bearerToken(request) !== undefined)
}

/** Every page, element and media key in an answer, for purge tags. Pure. */
export function keysIn(body: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(body)) for (const item of body) keysIn(item, into)
  else if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (
      typeof record.id === 'string' &&
      (typeof record.contentType === 'string' || typeof record.mediaType === 'string')
    )
      into.add(record.id)
    for (const value of Object.values(record))
      if (value && typeof value === 'object') keysIn(value, into)
  }
  return into
}

/** The caller's key, compared exactly; a site without one has none to match. Pure. */
export const hasValidApiKey = (settings: DeliveryApiSettings, request: Request): boolean =>
  settings.apiKey !== undefined && request.headers.get('api-key') === settings.apiKey

export const isPreview = (request: Request): boolean =>
  request.headers.get('preview')?.toLowerCase() === 'true'

/** Umbraco's `ApiAccessService`. Pure. */
export function contentAccess(settings: DeliveryApiSettings, request: Request): boolean {
  if (!settings.enabled) return false
  if (isPreview(request)) return hasValidApiKey(settings, request)
  return settings.publicAccess || hasValidApiKey(settings, request)
}

export function mediaAccess(settings: DeliveryApiSettings, request: Request): boolean {
  return (
    settings.enabled &&
    settings.media.enabled &&
    ((settings.publicAccess && settings.media.publicAccess) || hasValidApiKey(settings, request))
  )
}

/** `Accept-Language` only when it is one plain culture name; otherwise none. Pure. */
export function requestedCulture(header: string | null): string | undefined {
  const value = header?.trim()
  return value && /^[\w-]*$/.test(value) ? value : undefined
}

/** The bearer token from the `Authorization` header only — never the query string. Pure. */
export function bearerToken(request: Request): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')
  return match?.[1]?.trim() || undefined
}

const intParam = (url: URL, name: string, fallback: number): number | Response => {
  const raw = url.searchParams.get(name)
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : invalid(name, raw)
}

const expansionOf = (url: URL): { expand: ExpansionNode; include: ExpansionNode } | Response => {
  try {
    const fields = url.searchParams.get('fields')
    return {
      expand: parseExpansion(url.searchParams.get('expand') ?? ''),
      include: fields ? parseExpansion(fields) : ALL_FIELDS,
    }
  } catch (error) {
    if (!(error instanceof ExpansionSyntaxError)) throw error
    return Response.json(
      { type: 'Error', title: 'Invalid expansion', status: 400, detail: error.message },
      { status: 400, headers: { 'content-type': 'application/problem+json' } },
    )
  }
}

export function createDeliveryApi(ports: DeliveryApiPorts): DeliveryApi {
  const { settings, cache } = ports
  const prefix = ports.prefix.replace(/\/$/, '')
  const caching = ports.caching ?? resolveCacheSettings()

  /** What each public answer holds, so its lifetime and tags are those of its pages and media. */
  const holds = new WeakMap<Response, { items: Cacheable[]; tags: string[] }>()
  const holding = (
    response: Response,
    items: Cacheable[],
    tags: string[] = [],
    drawn?: { formDrawn(): boolean },
  ) => {
    if (drawn?.formDrawn()) response.headers.set('cache-control', 'no-store')
    holds.set(response, { items, tags })
    return response
  }
  const page = (content: PublishedContent): Cacheable => ({
    typeAlias: content.contentType.alias,
    value: (alias) => content.value(alias),
  })
  const mediaItem = (media: PublishedMedia): Cacheable => ({
    typeAlias: media.mediaType.alias,
    value: (alias) => media.value(alias),
  })

  /**
   * A public answer's lifetime, ETag and tags; a `304` when the caller holds it.
   * Anything that depends on who asks is never kept.
   */
  async function finish(request: Request, response: Response, personal: boolean) {
    if (personal) {
      response.headers.set('cache-control', PRIVATE_NO_STORE)
      return response
    }
    const held = holds.get(response)
    if (!held || response.status !== 200) return response
    const body = await response.text()
    const lifetime =
      response.headers.get('cache-control') === 'no-store'
        ? 'none'
        : shortest(
            held.items.map((item) => lifetimeFor(caching, item)),
            caching.site,
          )
    const tags = caching.tagHeader ? [...held.tags, ...keysIn(JSON.parse(body))] : undefined
    return cacheable(request, response, body, { lifetime, tags, tagHeader: caching.tagHeader })
  }

  /** The member a request's token names, when member sign-in is on. */
  async function memberOf(request: Request): Promise<DeliveryMember | undefined> {
    const token = bearerToken(request)
    return token && memberAuthorizationEnabled(settings) ? ports.member(token) : undefined
  }

  const loadMediaRules = async () =>
    new Map(((await ports.mediaRules?.()) ?? []).map((rule) => [rule.nodeId, rule]))

  /**
   * Everything a content request decides once: culture, member, rules, routes.
   * A preview reads the draft cache, and an editor's sees only what they may read.
   */
  async function contentRequest(
    request: Request,
    preview?: PreviewAccess,
    /** A culture the address chose, which wins over `Accept-Language`. */
    chosen?: string | null,
  ) {
    const source = preview?.cache ?? cache
    const asked =
      chosen !== undefined && chosen !== null
        ? chosen
        : requestedCulture(request.headers.get('accept-language'))
    const culture = asked ?? (await source.defaultCulture())
    const known = asked === undefined || (await source.hasCulture(asked))
    const nav = await source.navigation(culture)
    const hide = await source.hidesTopLevel()
    const roots = nav.root()
    const rtl = isRightToLeft(culture)

    const member = await memberOf(request)
    const loadedRules = new Map((await ports.protection()).map((rule) => [rule.nodeId, rule]))
    const mediaRules = await loadMediaRules()

    const routeIn = async (inCulture: string | null) => {
      const view = await source.navigation(inCulture)
      const first = view.root()[0]
      const cultureRtl = isRightToLeft(inCulture)
      return (content: PublishedContent): ApiRoute | undefined => {
        const here = view.byKey(content.key)
        if (!here) return undefined
        const ancestors = view.ancestors(here)
        const root = ancestors[ancestors.length - 1] ?? here
        let path: string
        // A site's settings page has no address (story 058): `#`, as its URL is.
        if (view.isSettings?.(here)) path = '#'
        else if (ancestors.length === 0)
          path = hide && first && here.id !== first.id ? `/${here.urlSegment}` : '/'
        else {
          const below = [...ancestors.slice(0, -1).reverse(), here].map((c) => c.urlSegment)
          path = `/${(cultureRtl ? below.reverse() : below).join('/')}`
        }
        return { path, queryString: null, startItem: { id: root.key, path: root.urlSegment } }
      }
    }
    const route = await routeIn(culture)

    const chainOf = (content: PublishedContent) => [
      ...[...nav.ancestors(content)].reverse().map((c) => c.key),
      content.key,
    ]
    const readable = (content: PublishedContent) =>
      !preview?.mayRead || preview.mayRead(chainOf(content))

    // A form carries a token signed for when it was drawn, so an answer holding one
    // is never kept: a stale draw time would let a bot past the timing guard.
    let formDrawn = false
    const shapeForm = ports.forms ? await ports.forms.shaper(culture, request) : undefined

    const ctx: OutputContext = {
      form: shapeForm
        ? (form) => {
            formDrawn = true
            return shapeForm(form)
          }
        : undefined,
      route,
      content: (key) => nav.byKey(key),
      allowedType: (alias) => isAllowedContentType(settings, alias),
      // A page the previewing editor may not read keeps its route in a picker, never its properties.
      access: (content) =>
        readable(content) ? accessTo(content.path, loadedRules, member) : 'forbidden',
      mediaAccess: (media) => mediaAccessTo(media, mediaRules, member),
      media: async (keys) => (ports.media ? ports.media.byKeys(keys) : []),
    }

    /** Below a node by URL segments, exactly as stored. */
    const walk = (
      from: readonly PublishedContent[],
      segments: readonly string[],
    ): PublishedContent | undefined => {
      let level = from
      let found: PublishedContent | undefined
      for (const segment of segments) {
        found = level.find((c) => c.urlSegment === segment)
        if (!found) return undefined
        level = nav.children(found)
      }
      return found
    }

    /** `Start-Item`: a root's key, or a root's segment in any case. */
    const startItemHeader = request.headers.get('start-item')?.replace(/^\/+|\/+$/g, '')
    const startItem = startItemHeader
      ? roots.find((r) =>
          GUID.test(startItemHeader)
            ? r.key === startItemHeader.toLowerCase()
            : r.urlSegment.toLowerCase() === startItemHeader.toLowerCase(),
        )
      : undefined
    const badStartItem = Boolean(startItemHeader) && !startItem

    const byPath = (raw: string): PublishedContent | undefined => {
      const decoded = raw.includes('%2F') || raw.includes('%2f') ? decodeURIComponent(raw) : raw
      let segments = decoded.split('/').filter(Boolean)
      if (rtl) segments = [...segments].reverse()
      if (startItem)
        return segments.length === 0 ? startItem : walk(nav.children(startItem), segments)
      if (segments.length === 0) return roots[0]
      if (!hide) return walk(roots, segments)
      if (segments.length === 1) {
        const root = roots.find((r) => r.urlSegment === segments[0])
        if (root) return root
      }
      for (const root of roots) {
        const found = walk(nav.children(root), segments)
        if (found) return found
      }
      return undefined
    }

    const servable = (content: PublishedContent | undefined) =>
      content &&
      known &&
      isAllowedContentType(settings, content.contentType.alias) &&
      readable(content) &&
      route(content)
        ? content
        : undefined

    const respond = async (content: PublishedContent, url: URL) => {
      const expansion = expansionOf(url)
      if (expansion instanceof Response) return expansion
      const routes = new Map<string, (c: PublishedContent) => ApiRoute | undefined>()
      for (const c of content.cultures) routes.set(c, await routeIn(c))
      const body = await apiContentResponse(
        content,
        ctx,
        (c) => routes.get(c)?.(content),
        expansion.expand,
        expansion.include,
      )
      // Asked for, so answers that do not want them stay the size Umbraco's are.
      if (body && ports.seo && url.searchParams.get('seo') === 'true')
        return { ...body, seo: await ports.seo(content, request) }
      return body
    }

    return {
      source,
      shapeForm,
      formDrawn: () => formDrawn,
      culture,
      known,
      nav,
      roots,
      member,
      rules: [...loadedRules.values()],
      ctx,
      byPath,
      startItem,
      badStartItem,
      servable,
      respond,
    }
  }

  type ContentRequest = Awaited<ReturnType<typeof contentRequest>>

  const json = (body: unknown) => Response.json(body, { headers: { vary: CONTENT_VARY } })

  async function contentItem(r: ContentRequest, content: PublishedContent | undefined, url: URL) {
    const found = r.servable(content)
    if (!found) return bare(404)
    const access = r.ctx.access(found)
    if (access !== 'allowed') return bare(access === 'forbidden' ? 403 : 401)
    const body = await r.respond(found, url)
    if (body instanceof Response) return body
    return body ? holding(json(body), [page(found)], [], r) : bare(404)
  }

  async function contentItems(r: ContentRequest, url: URL) {
    const ids = [...new Set(url.searchParams.getAll('id').map((id) => id.toLowerCase()))]
    for (const id of ids) if (!GUID.test(id)) return invalid('id', id)
    const found = ids.flatMap((id) => {
      const content = r.servable(r.nav.byKey(id))
      return content ? [content] : []
    })
    for (const content of found) {
      const access = r.ctx.access(content)
      if (access !== 'allowed') return bare(access === 'forbidden' ? 403 : 401)
    }
    const out = []
    for (const content of found) {
      const body = await r.respond(content, url)
      if (body instanceof Response) return body
      if (body) out.push(body)
    }
    return holding(json(out), found.map(page), [], r)
  }

  async function contentQuery(r: ContentRequest, url: URL) {
    const selector = parseContentSelector(url.searchParams.get('fetch'))
    if (typeof selector === 'string') return problem(selector)
    const filters = parseContentFilters(url.searchParams.getAll('filter'))
    if (typeof filters === 'string') return problem(filters)
    const sorts = parseContentSorts(url.searchParams.getAll('sort'))
    if (typeof sorts === 'string') return problem(sorts)
    const skip = intParam(url, 'skip', 0)
    if (skip instanceof Response) return skip
    const take = intParam(url, 'take', 10)
    if (take instanceof Response) return take

    const all = r.known ? await r.source.contentIn(r.culture) : []
    const resolveTarget = (target: string): PublishedContent | 'roots' | undefined => {
      if (!target) return undefined
      if (target === ROOT_KEY) return 'roots'
      if (GUID.test(target)) return r.nav.byKey(target)
      return r.byPath(target)
    }
    let candidates: PublishedContent[]
    if (selector.kind === 'all')
      candidates = r.startItem
        ? all.filter(
            (c) => c.id !== r.startItem?.id && c.path.split(',').includes(String(r.startItem?.id)),
          )
        : all
    else {
      const target = resolveTarget(selector.target)
      if (!target) candidates = []
      else if (selector.kind === 'children')
        candidates = target === 'roots' ? r.roots : r.nav.children(target)
      else if (target === 'roots') candidates = selector.kind === 'descendants' ? all : []
      else if (selector.kind === 'ancestors') candidates = [...r.nav.ancestors(target)].reverse()
      else
        candidates = all.filter(
          (c) => c.id !== target.id && c.path.split(',').includes(String(target.id)),
        )
    }

    // A members-only page is never listed for a caller who cannot open it,
    // whether or not member sign-in is on (Umbraco lists them when it is off).
    const visible = candidates.filter(
      (c) =>
        isAllowedContentType(settings, c.contentType.alias) &&
        r.ctx.access(c) === 'allowed' &&
        passesFilters(
          {
            contentType: c.contentType.alias,
            name: c.name,
            createDate: c.createDate,
            updateDate: c.updateDate,
          },
          filters,
        ),
    )
    const ordered =
      sorts.length > 0
        ? [...visible].sort(
            compareBy(sorts) as (a: PublishedContent, b: PublishedContent) => number,
          )
        : visible
    const items = []
    const shown = ordered.slice(skip, skip + take)
    for (const content of shown) {
      const body = await r.respond(content, url)
      if (body instanceof Response) return body
      if (body) items.push(body)
    }
    // A new page under the one fetched from changes this list, so it carries that page's tag.
    const from = selector.kind === 'all' ? undefined : resolveTarget(selector.target)
    return holding(
      json({ total: ordered.length, items }),
      shown.map(page),
      from && from !== 'roots' ? [from.key] : [],
      r,
    )
  }

  async function handleMedia(request: Request, url: URL, rest: string) {
    if (!mediaAccess(settings, request)) return bare(401)
    const library = ports.media
    // A protected item is left out of every list for a caller who cannot read it.
    const member = await memberOf(request)
    const rules = await loadMediaRules()
    const accessOf = (m: PublishedMedia) => mediaAccessTo(m, rules, member)
    const readable = (m: PublishedMedia) => accessOf(m) === 'allowed'
    const answer = async (items: readonly PublishedMedia[]) => {
      const paths = library ? await library.paths(items) : new Map<number, string>()
      const out = []
      for (const m of items) out.push(await apiMediaResponse(m, paths.get(m.id) ?? '/'))
      return out
    }
    if (rest === 'items') {
      const ids = [...new Set(url.searchParams.getAll('id').map((id) => id.toLowerCase()))]
      for (const id of ids) if (!GUID.test(id)) return invalid('id', id)
      const found = (library ? await library.byKeys(ids) : []).filter(readable)
      return holding(Response.json(await answer(found)), found.map(mediaItem))
    }
    if (rest.startsWith('item/')) {
      const target = rest.slice('item/'.length)
      const found = !library
        ? undefined
        : GUID.test(target)
          ? (await library.byKeys([target.toLowerCase()]))[0]
          : await library.byPath(decodeURIComponent(target))
      if (!found) return bare(404)
      const access = accessOf(found)
      if (access !== 'allowed') return bare(access === 'unauthorized' ? 401 : 403)
      const [body] = await answer([found])
      return holding(Response.json(body), [mediaItem(found)])
    }
    if (rest !== '') return undefined
    const query = parseMediaQuery({
      fetch: url.searchParams.get('fetch'),
      filters: url.searchParams.getAll('filter'),
      sorts: url.searchParams.getAll('sort'),
    })
    if (typeof query === 'string') return problem(query)
    const skip = intParam(url, 'skip', 0)
    if (skip instanceof Response) return skip
    const take = intParam(url, 'take', 10)
    if (take instanceof Response) return take
    let parent: PublishedMedia | 'root' | undefined
    if (!library || query.parent === '') parent = undefined
    else if (/^\/+$/.test(query.parent)) parent = 'root'
    else if (GUID.test(query.parent))
      parent = (await library.byKeys([query.parent.toLowerCase()]))[0]
    else parent = await library.byPath(decodeURIComponent(query.parent))
    // Paged by the database, readable items only, so `total` counts what this caller may see.
    const page =
      parent && library
        ? await library.children(parent, {
            filters: query.filters,
            sort: query.sort,
            skip,
            take,
            readable: {
              rules,
              member:
                member?.approved && !member.lockedOut
                  ? { key: member.key, groups: member.groups }
                  : undefined,
            },
          })
        : { total: 0, items: [] }
    return holding(
      Response.json({ total: page.total, items: await answer(page.items) }),
      page.items.map(mediaItem),
    )
  }

  /**
   * `v2/search?term=&contentType=&skip=&take=`: published pages matching every
   * word, best first, as content items with `score` and an `excerpt` in HTML.
   * A members-only page is left out, and not counted, for a caller who cannot
   * open it.
   */
  async function contentSearch(r: ContentRequest, url: URL) {
    if (!ports.search) return bare(404)
    const skip = intParam(url, 'skip', 0)
    if (skip instanceof Response) return skip
    const take = intParam(url, 'take', 10)
    if (take instanceof Response) return take
    const term = url.searchParams.get('term')?.trim() ?? ''
    if (!term || !r.known) return json({ total: 0, items: [] })
    // A member who may not sign in now opens nothing a visitor could not.
    const member =
      r.member?.approved && !r.member.lockedOut
        ? { username: r.member.userName, groups: r.member.groups }
        : undefined
    const hits = await ports.search(term, {
      culture: r.culture ?? '',
      types: url.searchParams.getAll('contentType').filter(Boolean),
      skip,
      take: Math.min(take, 100),
      access: branchAccess(r.rules, member),
    })
    const items = []
    const shown: PublishedContent[] = []
    for (const hit of hits.items) {
      const content = r.servable(r.nav.byKey(hit.key))
      if (!content || r.ctx.access(content) !== 'allowed') continue
      const body = await r.respond(content, url)
      if (body instanceof Response) return body
      if (body) {
        shown.push(content)
        items.push({ ...body, score: hit.score, excerpt: excerptHtml(excerpt(hit.text, term)) })
      }
    }
    return holding(json({ total: hits.total, items }), shown.map(page), [], r)
  }

  const cors = corsPolicy(settings)
  const corsOn = cors.origins.size > 0 || cors.any

  return {
    problems: cors.problems,
    async handle(request) {
      const url = new URL(request.url)
      if (!url.pathname.startsWith(`${prefix}/`)) return undefined
      const rest = url.pathname.slice(prefix.length + 1)
      const methods = corsOn ? corsMethodsFor(rest) : undefined
      if (!methods) return route(request, url, rest)
      if (isPreflight(request)) return preflightResponse(cors, request, methods)
      const response = await route(request, url, rest)
      return response && withCors(cors, request, response)
    },
  }

  async function route(request: Request, url: URL, rest: string) {
    const security = /^v1\/security\/member\/(.+)$/.exec(rest)
    if (security) return ports.security?.(request, security[1] as string)

    if (/^v2\/search\/?$/.test(rest)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return bare(405)
      if (!contentAccess(settings, request)) return bare(401)
      const response = await contentSearch(await contentRequest(request), url)
      return finish(
        request,
        response,
        personal(request, settings.publicAccess, memberAuthorizationEnabled(settings)),
      )
    }

    const menuMatch = /^v2\/menus\/([^/]+)\/?$/.exec(rest)
    if (menuMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return bare(405)
      const preview = isPreview(request) ? await previewAccess(request) : undefined
      if (preview === null) return bare(401)
      if (!preview && !contentAccess(settings, request)) return bare(401)
      const response = await menuAnswer(
        request,
        decodeURIComponent(menuMatch[1] as string),
        preview,
      )
      if (preview) {
        response.headers.set('cache-control', 'no-store')
        return response
      }
      return finish(
        request,
        response,
        personal(request, settings.publicAccess, memberAuthorizationEnabled(settings)),
      )
    }

    // Story 058: the dictionary as a map, and the site's settings page.
    const siteWide = /^v2\/(dictionary|settings)\/?$/.exec(rest)?.[1]
    if (siteWide) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return bare(405)
      const preview = isPreview(request) ? await previewAccess(request) : undefined
      if (preview === null) return bare(401)
      if (!preview && !contentAccess(settings, request)) return bare(401)
      const response =
        siteWide === 'dictionary'
          ? await dictionaryAnswer(request, url, preview)
          : await settingsAnswer(request, url, preview)
      if (preview) {
        response.headers.set('cache-control', 'no-store')
        return response
      }
      return finish(
        request,
        response,
        personal(request, settings.publicAccess, memberAuthorizationEnabled(settings)),
      )
    }

    const formMatch = /^v2\/forms\/([^/]+)\/?$/.exec(rest)
    if (formMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return bare(405)
      if (!contentAccess(settings, request)) return bare(401)
      const form = ports.forms?.byKey(decodeURIComponent(formMatch[1] as string))
      if (!form) return bare(404)
      const r = await contentRequest(request)
      const shaped = r.shapeForm?.(form)
      if (!shaped) return bare(404)
      // Drawn now, with a token for now: never kept, so the timing guard means what it says.
      return Response.json(shaped, { headers: { vary: CONTENT_VARY, 'cache-control': 'no-store' } })
    }

    if (/^v2\/sitemap\/?$/.test(rest)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return bare(405)
      if (!contentAccess(settings, request)) return bare(401)
      const items = await ports.sitemap?.(request, url.searchParams.get('host') || url.host)
      if (!items) return bare(404)
      return finish(
        request,
        holding(json({ total: items.length, items }), []),
        personal(request, settings.publicAccess, memberAuthorizationEnabled(settings)),
      )
    }

    if (/^v2\/route\/?$/.test(rest)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return bare(405)
      const preview = isPreview(request) ? await previewAccess(request) : undefined
      if (preview === null) return bare(401)
      if (!preview && !contentAccess(settings, request)) return bare(401)
      const response = await routeLookup(request, url, preview)
      if (preview) {
        response.headers.set('cache-control', 'no-store')
        return response
      }
      return finish(
        request,
        response,
        personal(request, settings.publicAccess, memberAuthorizationEnabled(settings)),
      )
    }

    const match = /^v2\/(content|media)(?:\/(.*))?$/.exec(rest)
    if (!match) return undefined
    if (request.method !== 'GET' && request.method !== 'HEAD') return bare(405)
    const area = match[1]
    const tail = (match[2] ?? '').replace(/\/$/, '')

    if (area === 'media') {
      const response =
        (await handleMedia(request, url, tail === '' && match[2] === undefined ? '' : tail)) ??
        bare(404)
      return finish(
        request,
        response,
        personal(
          request,
          settings.publicAccess && settings.media.publicAccess,
          memberAuthorizationEnabled(settings),
        ),
      )
    }

    const preview = isPreview(request) ? await previewAccess(request) : undefined
    if (preview === null) return bare(401)
    if (!preview && !contentAccess(settings, request)) return bare(401)
    const response = await contentRoute(request, url, match[2], tail, preview)
    // A draft is never kept by a cache between here and the app.
    if (preview) {
      response.headers.set('cache-control', 'no-store')
      return response
    }
    return finish(
      request,
      response,
      personal(request, settings.publicAccess, memberAuthorizationEnabled(settings)),
    )
  }

  /**
   * `v2/route?path=&host=` (story 054): what the site would answer at an address
   * — the page, a redirect, or not found with the site's not-found page — so an
   * app's router behaves as the rendered site does. A Crombolo addition.
   */
  async function routeLookup(
    request: Request,
    url: URL,
    preview: PreviewAccess | undefined,
  ): Promise<Response> {
    const path = url.searchParams.get('path')
    if (!path) return invalid('path', '')
    const host = url.searchParams.get('host') || url.host
    const pathname = path.startsWith('/') ? path : `/${path}`
    const found = await (preview?.cache ?? cache).resolve(host, pathname)
    // A page that sends its visitors elsewhere (`umbracoRedirect`), as the site's 302 does.
    if (found?.redirect) return redirectAnswer(found.redirect, 302)
    if (found) {
      const r = await contentRequest(request, preview, found.culture)
      const content = r.servable(r.nav.byKey(found.content.key))
      if (content) {
        const access = r.ctx.access(content)
        if (access !== 'allowed') return bare(access === 'forbidden' ? 403 : 401)
        const item = await r.respond(content, url)
        if (item instanceof Response) return item
        if (item)
          return holding(
            json({ kind: 'page', culture: found.culture, item }),
            [page(content)],
            [],
            r,
          )
      }
    }
    // Only once no page answered, so a redirect never hides live content.
    const redirect = await cache.redirect(host, pathname)
    if (redirect) return redirectAnswer(redirect.location, redirect.statusCode)
    const missing = await ports.notFound?.(host, pathname)
    let item: Record<string, unknown> | null = null
    if (missing) {
      const r = await contentRequest(request, preview, missing.culture)
      const content = r.servable(r.nav.byKey(missing.key))
      const body =
        content && r.ctx.access(content) === 'allowed' ? await r.respond(content, url) : null
      if (body && !(body instanceof Response)) item = body
    }
    return Response.json(
      { kind: 'notFound', item },
      { status: 404, headers: { vary: CONTENT_VARY } },
    )
  }

  /**
   * `v2/dictionary` (story 058): every item in the request's culture, falling
   * back as `dictionary()` does, `''` where none does; `?keys=` narrows it.
   */
  async function dictionaryAnswer(
    request: Request,
    url: URL,
    preview: PreviewAccess | undefined,
  ): Promise<Response> {
    const r = await contentRequest(request, preview)
    if (!r.known) return bare(404)
    const keys = url.searchParams
      .get('keys')
      ?.split(',')
      .map((key) => key.trim())
      .filter(Boolean)
    const items = await r.source.dictionaryEntries(r.culture, keys)
    return holding(json(items), [], [DICTIONARY_TAG])
  }

  /**
   * `v2/settings` (story 058): the settings page under the request's root, its
   * `Start-Item`, else the root its host serves, else the first root.
   */
  async function settingsAnswer(
    request: Request,
    url: URL,
    preview: PreviewAccess | undefined,
  ): Promise<Response> {
    const r = await contentRequest(request, preview)
    if (r.badStartItem) return Response.json('The Start-Item could not be found', { status: 404 })
    const rootKey =
      r.startItem?.key ?? (await r.source.rootForHost(url.host)) ?? r.roots[0]?.key ?? null
    const found = r.known ? await r.source.settings(rootKey, r.culture) : undefined
    return contentItem(r, found, url)
  }

  /** A redirect as data. Never kept, as the site's are not: renaming back must not strand anyone. */
  /**
   * `v2/menus/{alias}` (story 141): a menu's items in the request's culture. A
   * page the caller may not open, or of a type the API does not serve, is left
   * out with the items below it, as a members-only page is from a query.
   */
  async function menuAnswer(
    request: Request,
    alias: string,
    preview: PreviewAccess | undefined,
  ): Promise<Response> {
    const r = await contentRequest(request, preview)
    const menu = r.known ? await r.source.menu(alias, r.culture) : undefined
    if (!menu) return bare(404)
    const pages: PublishedContent[] = []
    const shape = (items: readonly MenuItem[]): Record<string, unknown>[] =>
      items.flatMap((item) => {
        let route: ApiRoute | undefined
        if (item.kind === 'page') {
          const content = item.content ? r.nav.byKey(item.content.key) : undefined
          if (!content || !r.servable(content) || r.ctx.access(content) !== 'allowed') return []
          route = r.ctx.route(content)
          pages.push(content)
        }
        return [
          {
            label: item.label,
            kind: item.kind,
            id: item.key,
            url: item.kind === 'page' ? null : item.url,
            route: route ?? null,
            target: item.target,
            children: shape(item.children),
          },
        ]
      })
    const items = shape(menu.items)
    return holding(json({ alias: menu.alias, items }), pages.map(page), [
      menu.key,
      ...pages.map((p) => p.key),
    ])
  }

  function redirectAnswer(location: string, statusCode: number): Response {
    return Response.json(
      {
        kind: 'redirect',
        location,
        statusCode,
        permanent: statusCode === 301 || statusCode === 308,
      },
      { headers: { vary: CONTENT_VARY, 'cache-control': 'no-store' } },
    )
  }

  /** Drafts for a preview with the key or a preview token; null when it may not preview. */
  async function previewAccess(request: Request): Promise<PreviewAccess | null> {
    if (!settings.enabled) return null
    const keyed = hasValidApiKey(settings, request)
    const access = await ports.preview?.(request, keyed)
    if (access) return access
    // Without drafts to read, a keyed preview answers from what is published, as it always has.
    return keyed && !ports.preview ? { cache } : null
  }

  async function contentRoute(
    request: Request,
    url: URL,
    rest: string | undefined,
    tail: string,
    preview: PreviewAccess | undefined,
  ): Promise<Response> {
    const r = await contentRequest(request, preview)
    if (r.badStartItem) return Response.json('The Start-Item could not be found', { status: 404 })
    if (tail === '' && rest === undefined) return contentQuery(r, url)
    if (tail === 'items') return contentItems(r, url)
    if (rest?.startsWith('item')) {
      const target = rest.replace(/^item\/?/, '').replace(/\/$/, '')
      // Umbraco's address for a page in preview, whether or not it has a route.
      const previewKey = preview ? PREVIEW_PATH.exec(target)?.[1] : undefined
      if (previewKey) return contentItem(r, r.nav.byKey(previewKey.toLowerCase()), url)
      return contentItem(r, GUID.test(target) ? r.nav.byKey(target) : r.byPath(target), url)
    }
    return bare(404)
  }
}
