/**
 * The published content cache.
 *
 * Published only — drafts are never cached — and rebuilt from the database on
 * invalidation. Umbraco runs three tiers here (in-process objects, a hybrid
 * memory/distributed cache, and a serialised table); a single Bun process needs
 * only the first, and the other two are pure throughput. See docs/rendering.md.
 *
 * Content is held once per culture: a node that varies by culture appears in
 * each culture it is published in, with that culture's name, URL and values
 * in scope; an invariant node appears in every culture. Pickers, links and
 * navigation resolve within the culture of the page that asks.
 */

import {
  type ChoiceOption,
  type ChoiceSource,
  MENU_ALIAS_PROPERTY,
  type SchemaForm,
  withResolvedChoices,
} from '@crombolo/core'
import type { PublishedMedia } from './media.ts'
import type { MediaCache } from './media-cache.ts'
import { buildMenu, type Menu, type MenuItem, menuMediaKeys } from './menus.ts'
import { type Navigation, PublishedContent, type PublishedProperty } from './model.ts'
import { matchRedirect, type RedirectRule } from './redirects.ts'
import {
  joinPath,
  REDIRECT_ALIAS,
  URL_ALIAS_ALIAS,
  URL_NAME_ALIAS,
  urlSegmentFor,
} from './url-segment.ts'
import { PublishedElement, type ValueContext } from './values.ts'

export interface PublishedNode {
  key: string
  id: number
  parentId: number
  level: number
  path: string
  sortOrder: number
  /** The invariant name; a culture's own name comes from `names`. */
  name: string
  contentTypeAlias: string
  componentAlias: string | null
  createDate: Date
  updateDate: Date
  /** The cultures a culture-varying node is published in; empty for an invariant node. */
  cultures: string[]
  /** Each published culture's name. */
  names?: Record<string, string>
  properties: PublishedProperty[]
}

/** A hostname (or wildcard) assigned to a document; see `DomainRepository`. */
export interface PublishedDomain {
  nodeId: number
  /** Normalised: no scheme, lowercase, no trailing slash, e.g. `example.com/en`. */
  domainName: string
  isoCode: string | null
  isWildcard: boolean
}

export interface PublishedLanguage {
  isoCode: string
  isDefault: boolean
  fallbackIsoCode: string | null
}

export interface PublishedContentSource {
  /** Every published document, in tree order. */
  loadPublished(): Promise<PublishedNode[]>
  /** Culture and hostnames, in sort order; none when omitted. */
  loadDomains?(): Promise<PublishedDomain[]>
  /** The site's languages; an invariant site when omitted. */
  loadLanguages?(): Promise<PublishedLanguage[]>
  /** Dictionary translations, by item key then culture; none when omitted. */
  loadDictionary?(): Promise<Map<string, Map<string, string>>>
  /** Every dictionary item with its parent's name, for choice lists; none when omitted. */
  loadDictionaryOutline?(): Promise<DictionaryOutlineItem[]>
  /** Redirect rules, configured ones first; none when omitted. */
  loadRedirects?(): Promise<RedirectRule[]>
  /** Published library elements, for the pickers that point at them; none when omitted. */
  loadElements?(): Promise<PublishedElementNode[]>
  /** Content type aliases by key, so a block knows its element type; none when omitted. */
  loadContentTypeAliases?(): Promise<Map<string, string>>
  /** How URLs are built; Umbraco's defaults when omitted. */
  loadUrlOptions?(): Promise<PublishedUrlOptions>
  /**
   * Runs a build's reads as one consistent state (story 174): `fn` is handed a
   * source bound to a single read snapshot, and the content checkpoint that
   * snapshot contains. Without it each load reads whatever is current.
   */
  withSnapshot?<T>(
    fn: (source: PublishedContentSource, checkpoint: number) => Promise<T>,
  ): Promise<T>
}

/** `HideTopLevelNodeFromPath`: true, Umbraco's default, leaves the top-level page out of paths. */
export interface PublishedUrlOptions {
  hideTopLevel: boolean
}

const RTL_LANGUAGES = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'ha',
  'he',
  'khw',
  'ks',
  'ps',
  'sd',
  'ur',
  'yi',
])

/** Whether a culture is written right to left, as .NET's `TextInfo.IsRightToLeft` says. Pure. */
export function isRightToLeft(culture: string | null | undefined): boolean {
  if (!culture) return false
  try {
    const locale = new Intl.Locale(culture) as Intl.Locale & {
      getTextInfo?: () => { direction?: string }
    }
    const direction = locale.getTextInfo?.().direction
    if (direction) return direction === 'rtl'
    return RTL_LANGUAGES.has(locale.language)
  } catch {
    return false
  }
}

/**
 * A published element: content something else points at, with no URL and no place
 * in a route. `cultures` is the set it is published in, empty for an invariant one,
 * so a culture's view holds only the elements that culture can see — which is how
 * Umbraco's own converter drops an element unpublished in the ambient culture.
 */
export interface PublishedElementNode {
  key: string
  contentTypeKey: string
  contentTypeAlias: string
  cultures: string[]
  properties: PublishedProperty[]
}

/** The published tree in one culture. */
export interface CultureView {
  culture: string | null
  byId: Map<number, PublishedContent>
  byKey: Map<string, PublishedContent>
  /** Published elements this culture can see, by lowercase key. */
  elements: Map<string, PublishedElement>
  childrenOf: Map<number, PublishedContent[]>
  roots: PublishedContent[]
  parentIdOf: Map<number, number>
}

export interface DictionaryOutlineItem {
  key: string
  name: string
  parentName: string | null
}

export interface CacheSnapshot {
  /** Keyed by lowercase culture; `''` holds an invariant site's single view. */
  views: Map<string, CultureView>
  defaultCulture: string | null
  /** `HideTopLevelNodeFromPath`, as this snapshot was built with it. */
  hideTopLevel?: boolean
  /** Routes without a hostname, in the default culture. */
  byRoute: Map<string, PublishedContent>
  /** `<domain name>:<route below it>`, for requests that match a hostname. */
  byDomainRoute: Map<string, PublishedContent>
  domains: PublishedDomain[]
  /** The key of the document each hostname roots, by its node id. */
  domainRoots: Map<number, string>
  /** `<culture>|<node id>` → the route the resolver reaches that content by. */
  routeKeys: Map<string, RouteKey>
  /** Configured rules first, in their declared order, then the tracked ones. */
  redirects: RedirectRule[]
  languages: PublishedLanguage[]
  /** Item key (lowercase) → culture (lowercase) → translation. */
  dictionary: Map<string, Map<string, string>>
  /** Every dictionary item, for a choice list drawn from one item's children. */
  dictionaryOutline: DictionaryOutlineItem[]
  /** Content type key (lowercase) → alias. */
  contentTypeAliases: Map<string, string>
  /**
   * The content checkpoint whose changes this snapshot holds (story 174): every
   * change numbered at or below it, and none above. Absent from a source that
   * cannot say.
   */
  checkpoint?: number
  /** When it was built. */
  builtAt?: Date
}

/** What a request resolved to: the content, and the culture its hostname assigns. */
export interface ResolvedRequest {
  content: PublishedContent
  culture: string | null
  /** Where `umbracoRedirect` sends the visitor instead, when the page sets it. */
  redirect?: string
}

/**
 * How the resolver identifies a route: the path, and — when a hostname roots it —
 * the document that hostname sits on, so the identity survives a hostname change.
 */
export interface RouteKey {
  rootKey: string | null
  path: string
}

/** One route a document answers on, in one culture. */
export interface DocumentRoute extends RouteKey {
  key: string
  culture: string | null
}

/** Where a matched redirect sends the visitor. */
export interface RedirectHit {
  location: string
  statusCode: number
}

const EMPTY: CacheSnapshot = {
  views: new Map(),
  defaultCulture: null,
  byRoute: new Map(),
  byDomainRoute: new Map(),
  domains: [],
  domainRoots: new Map(),
  routeKeys: new Map(),
  redirects: [],
  languages: [],
  dictionary: new Map(),
  dictionaryOutline: [],
  contentTypeAliases: new Map(),
}

const normaliseRoute = (route: string) =>
  (route === '' ? '/' : route.replace(/\/+$/, '') || '/').toLowerCase()
const viewKey = (culture: string | null) => (culture ?? '').toLowerCase()
const routeKeyId = (culture: string | null, id: number) => `${viewKey(culture)}|${id}`

/** The fallback languages of `culture`, nearest first, stopping at a cycle. */
export function fallbackChain(
  languages: readonly PublishedLanguage[],
  culture: string | null,
): string[] {
  const chain: string[] = []
  let current = languages.find((l) => l.isoCode.toLowerCase() === viewKey(culture))
  while (current?.fallbackIsoCode) {
    const next = current.fallbackIsoCode
    if (
      chain.some((c) => c.toLowerCase() === next.toLowerCase()) ||
      next.toLowerCase() === viewKey(culture)
    )
      break
    chain.push(next)
    current = languages.find((l) => l.isoCode.toLowerCase() === next.toLowerCase())
  }
  return chain
}

/** What the cache needs besides content, for values that resolve outside it. */
export interface PublishedCacheOptions {
  /**
   * A form definition by key, for a `formPicker` property.
   *
   * A function rather than a map: form definitions are files, so they can change
   * without a publish invalidating this cache, and the lookup has to be able to
   * see that.
   */
  form?: (key: string) => SchemaForm | undefined
  /** Told on every invalidation, for whatever else is built from the same content. */
  onInvalidate?: () => void
  /**
   * Media, which the snapshot does not hold (story 197): pickers, links and
   * menus look items up here. Without one, nothing resolves to media.
   */
  media?: MediaCache
}

const NO_MEDIA = () => Promise.resolve(undefined)

/** A menu's items in a culture, from a snapshot already in hand; empty when there is none. */
export async function menuItemsIn(
  snapshot: CacheSnapshot,
  culture: string | null,
  alias: string,
  media?: MediaCache,
): Promise<MenuItem[]> {
  const view =
    snapshot.views.get(viewKey(culture ?? snapshot.defaultCulture)) ??
    snapshot.views.get(viewKey(snapshot.defaultCulture))
  return view ? ((await menuIn(view, alias, media))?.items ?? []) : []
}

const menuElements = (view: CultureView) =>
  [...view.elements.values()].filter((element) => element.contentType.alias === 'menu')

const menuAliasOf = (element: PublishedElement) => {
  const own = element.properties.find((p) => p.alias === MENU_ALIAS_PROPERTY)?.value
  return typeof own === 'string' ? own.trim().toLowerCase() : undefined
}

/** The menu published under `alias` in a view, its media looked up in one query. */
export async function menuIn(
  view: CultureView,
  alias: string,
  media?: MediaCache,
): Promise<Menu | undefined> {
  const wanted = alias.trim().toLowerCase()
  const element = menuElements(view).find((e) => menuAliasOf(e) === wanted)
  if (!element) return undefined
  const items = media ? await media.byKeys(menuMediaKeys(element)) : new Map()
  return buildMenu(element, {
    content: (key) => view.byKey.get(key.toLowerCase()),
    media: (key) => items.get(key.toLowerCase()),
  })
}

/** Every menu in a view by alias, their media looked up together: what a page render offers. */
export async function menusIn(
  view: CultureView | undefined,
  media?: MediaCache,
): Promise<Map<string, Menu>> {
  const out = new Map<string, Menu>()
  if (!view) return out
  const elements = menuElements(view)
  if (elements.length === 0) return out
  const items = media ? await media.byKeys(elements.flatMap(menuMediaKeys)) : new Map()
  for (const element of elements) {
    const alias = menuAliasOf(element)
    if (alias === undefined || out.has(alias)) continue
    out.set(
      alias,
      buildMenu(element, {
        content: (key) => view.byKey.get(key.toLowerCase()),
        media: (key) => items.get(key.toLowerCase()),
      }),
    )
  }
  return out
}

/**
 * Lets waiting requests in every few hundred nodes: a rebuild is long, and on
 * SQLite nothing else in it ever gives the thread up (story 175).
 */
function pacer(every = 250): () => Promise<void> {
  let count = 0
  return async () => {
    if (++count % every === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

export class PublishedCache {
  #source: PublishedContentSource
  #snapshot: CacheSnapshot = EMPTY
  #loaded = false
  #options: PublishedCacheOptions
  /** Moves on every invalidation, so a build that one overtook is not kept as current. */
  #generation = 0
  #building: { generation: number; done: Promise<CacheSnapshot> } | undefined
  #snapshotGeneration = -1
  /** A checkpoint past the snapshot's own that it is known to hold, every change between being media only. */
  #coveredTo: number | undefined

  constructor(source: PublishedContentSource, options: PublishedCacheOptions = {}) {
    this.#source = source
    this.#options = options
  }

  /** Dropped on publish or unpublish; the next read rebuilds it. */
  invalidate(): void {
    this.#loaded = false
    this.#generation += 1
    this.#options.onInvalidate?.()
  }

  /**
   * The current snapshot, building it if it was dropped. The reader that starts
   * a build waits for it; readers arriving while it builds are answered from
   * the previous snapshot rather than waiting (story 175). Before the first
   * build there is none, so they share the build.
   */
  async snapshot(): Promise<CacheSnapshot> {
    if (this.#loaded) return this.#snapshot
    const generation = this.#generation
    if (this.#building?.generation === generation)
      return this.#snapshotGeneration >= 0 ? this.#snapshot : this.#building.done
    return this.#start(generation)
  }

  /** Whether readers are being answered from a snapshot older than the latest change. */
  get stale(): boolean {
    return !this.#loaded && this.#snapshotGeneration >= 0
  }

  /** The snapshot holding every change made so far, waiting for a build in flight. */
  async fresh(): Promise<CacheSnapshot> {
    if (this.#loaded) return this.#snapshot
    const generation = this.#generation
    if (this.#building?.generation === generation) return this.#building.done
    return this.#start(generation)
  }

  /**
   * Builds for `generation`. A build an invalidation overtook still answers,
   * but the next read builds again.
   */
  #start(generation: number): Promise<CacheSnapshot> {
    const done = this.#build().then((snapshot) => {
      // A slower, older build must not replace a newer one that finished first,
      // nor a snapshot of older data one of newer data.
      const older =
        snapshot.checkpoint !== undefined &&
        this.#snapshot.checkpoint !== undefined &&
        snapshot.checkpoint < this.#snapshot.checkpoint
      if (generation >= this.#snapshotGeneration && !older) {
        this.#snapshot = snapshot
        this.#snapshotGeneration = generation
        this.#coveredTo = undefined
      }
      if (this.#generation === generation) this.#loaded = true
      return snapshot
    })
    const building = { generation, done }
    this.#building = building
    void done
      .finally(() => {
        if (this.#building === building) this.#building = undefined
      })
      .catch(() => {})
    return done
  }

  #view(snapshot: CacheSnapshot, culture: string | null | undefined): CultureView | undefined {
    return (
      snapshot.views.get(viewKey(culture ?? snapshot.defaultCulture)) ??
      snapshot.views.get(viewKey(snapshot.defaultCulture))
    )
  }

  async byRoute(route: string): Promise<PublishedContent | undefined> {
    const snapshot = await this.snapshot()
    return snapshot.byRoute.get(normaliseRoute(route))
  }

  /**
   * Resolves a request as Umbraco does: the longest hostname (with its optional
   * path prefix) that matches roots the route at that domain's document, in its
   * culture; with no match, the route resolves without domains, in the default
   * culture or the one a wildcard domain assigns.
   */
  /** The longest hostname (with its optional path prefix) that matches the request. */
  #domainFor(
    snapshot: CacheSnapshot,
    host: string,
    route: string,
  ): { domain: PublishedDomain; rest: string } | undefined {
    const hostName = host.toLowerCase()
    const bare = hostName.replace(/:\d+$/, '')
    let best: { domain: PublishedDomain; rest: string; prefixLength: number } | undefined
    for (const domain of snapshot.domains) {
      if (domain.isWildcard) continue
      const slash = domain.domainName.indexOf('/')
      const domainHost = slash < 0 ? domain.domainName : domain.domainName.slice(0, slash)
      const prefix = slash < 0 ? '' : domain.domainName.slice(slash)
      if (domainHost !== hostName && domainHost !== bare) continue
      if (prefix && route !== prefix && !route.startsWith(`${prefix}/`)) continue
      if (best && best.prefixLength >= prefix.length) continue
      best = { domain, rest: route.slice(prefix.length) || '/', prefixLength: prefix.length }
    }
    return best
  }

  async resolve(host: string, pathname: string): Promise<ResolvedRequest | undefined> {
    const found = await this.#resolve(host, pathname)
    if (!found) return undefined
    const target = found.content.value(REDIRECT_ALIAS)
    if (
      target instanceof PublishedContent &&
      target.url !== '#' &&
      target.key !== found.content.key
    )
      return { ...found, redirect: target.url }
    return found
  }

  /** The culture a request's hostname assigns, or the default; what a 404 renders in. */
  async cultureFor(host: string, pathname: string): Promise<string | null> {
    const snapshot = await this.snapshot()
    const best = this.#domainFor(snapshot, host, normaliseRoute(pathname))
    return best?.domain.isoCode ?? snapshot.defaultCulture
  }

  async #resolve(host: string, pathname: string): Promise<ResolvedRequest | undefined> {
    const snapshot = await this.snapshot()
    const route = normaliseRoute(pathname)
    const best = this.#domainFor(snapshot, host, route)
    if (best) {
      const content = snapshot.byDomainRoute.get(`${best.domain.domainName}:${best.rest}`)
      return content ? { content, culture: best.domain.isoCode ?? content.culture } : undefined
    }
    const content = snapshot.byRoute.get(route)
    if (!content) return undefined
    const wildcard = this.#wildcardCulture(snapshot, content)
    if (wildcard) {
      const localised = snapshot.views.get(viewKey(wildcard))?.byId.get(content.id)
      if (localised) return { content: localised, culture: wildcard }
    }
    return { content, culture: content.culture }
  }

  /**
   * The redirect a request matches, once route resolution has found no page.
   *
   * Configured rules are tried before tracked ones, and a rule a hostname scopes
   * only against a request that hostname roots. A rule naming a document resolves
   * through the cache, so it follows the page when it is renamed; one naming a
   * document that is gone or unpublished does not match at all, which leaves the
   * 404 rather than sending the visitor nowhere.
   */
  async redirect(host: string, pathname: string): Promise<RedirectHit | undefined> {
    const snapshot = await this.snapshot()
    if (snapshot.redirects.length === 0) return undefined
    const route = normaliseRoute(pathname)
    const domain = this.#domainFor(snapshot, host, route)
    const rootKey = domain ? (snapshot.domainRoots.get(domain.domain.nodeId) ?? null) : null
    const culture = domain?.domain.isoCode ?? snapshot.defaultCulture
    for (const rule of snapshot.redirects) {
      if (rule.rootKey !== null && rule.rootKey !== rootKey) continue
      if (rule.culture !== null && viewKey(rule.culture) !== viewKey(culture)) continue
      const scoped = rule.rootKey !== null && domain ? domain.rest : route
      const target = matchRedirect(rule, scoped)
      if (target === undefined) continue
      if (rule.targetKind !== 'document') return { location: target, statusCode: rule.statusCode }
      const content = this.#view(snapshot, culture)?.byKey.get(target.toLowerCase())
      if (!content || content.url === '#') continue
      return { location: content.url, statusCode: rule.statusCode }
    }
    return undefined
  }

  /**
   * Every route the document answers on, per culture, and optionally those of its
   * published descendants — what the redirect tracker compares before and after a
   * publish or a move.
   */
  async routes(key: string, includeDescendants = false): Promise<DocumentRoute[]> {
    const snapshot = await this.snapshot()
    const out: DocumentRoute[] = []
    for (const view of snapshot.views.values()) {
      const content = view.byKey.get(key.toLowerCase())
      if (!content) continue
      const branch = includeDescendants ? [content, ...descendantsOf(view, content)] : [content]
      for (const node of branch) {
        // A culture with no reachable URL has no route to redirect — Umbraco's
        // `IsValidRoute` guard, which keeps dead rules out of the table.
        if (node.url === '#') continue
        const route = snapshot.routeKeys.get(routeKeyId(view.culture, node.id))
        if (route) out.push({ key: node.key, culture: view.culture, ...route })
      }
    }
    return out
  }

  /** Every published document a culture can see, in tree order: what a headless query scans. */
  async contentIn(culture?: string | null): Promise<PublishedContent[]> {
    const snapshot = await this.snapshot()
    const view = this.#view(snapshot, culture)
    if (!view) return []
    const out: PublishedContent[] = []
    const walk = (items: readonly PublishedContent[]) => {
      for (const item of items) {
        out.push(item)
        walk(view.childrenOf.get(item.id) ?? [])
      }
    }
    walk(view.roots)
    return out
  }

  /** A menu by its alias, in a culture; undefined when none is published under it (story 141). */
  async menu(alias: string, culture?: string | null): Promise<Menu | undefined> {
    const snapshot = await this.snapshot()
    const view = this.#view(snapshot, culture)
    return view ? menuIn(view, alias, this.#options.media) : undefined
  }

  /** Every menu a culture's view publishes, by lowercase alias. */
  async menus(culture?: string | null): Promise<Map<string, Menu>> {
    const snapshot = await this.snapshot()
    return menusIn(this.#view(snapshot, culture), this.#options.media)
  }

  /** Where media is looked up (story 197); undefined when this cache resolves none. */
  get media(): MediaCache | undefined {
    return this.#options.media
  }

  /** How URLs are built here: whether the top-level page is left out of paths. */
  async hidesTopLevel(): Promise<boolean> {
    return (await this.snapshot()).hideTopLevel ?? true
  }

  /** The culture a request gets when it names none. */
  async defaultCulture(): Promise<string | null> {
    return (await this.snapshot()).defaultCulture
  }

  /** Whether a culture has a view here: a language the site has. */
  async hasCulture(culture: string): Promise<boolean> {
    return (await this.snapshot()).views.has(viewKey(culture))
  }

  /** The published children of a document, or of the tree root; keys, once each. */
  async childKeys(parentKey: string | null): Promise<string[]> {
    const snapshot = await this.snapshot()
    const keys = new Set<string>()
    for (const view of snapshot.views.values()) {
      if (parentKey === null) {
        for (const root of view.roots) keys.add(root.key)
        continue
      }
      const parent = view.byKey.get(parentKey.toLowerCase())
      if (!parent) continue
      for (const child of view.childrenOf.get(parent.id) ?? []) keys.add(child.key)
    }
    return [...keys]
  }

  /** The culture the nearest wildcard domain above the content assigns. */
  #wildcardCulture(snapshot: CacheSnapshot, content: PublishedContent): string | null {
    const ids = content.path.split(',').map(Number).reverse()
    for (const id of ids) {
      const wildcard = snapshot.domains.find((d) => d.nodeId === id && d.isWildcard)
      if (wildcard?.isoCode) return wildcard.isoCode
    }
    return null
  }

  /** The value context of a culture's view, for a model built outside it (preview). */
  async valueContext(culture?: string | null): Promise<ValueContext<PublishedContent>> {
    const snapshot = await this.snapshot()
    const view = this.#view(snapshot, culture)
    return {
      content: (key) => view?.byKey.get(key.toLowerCase()),
      media: this.#mediaLookup(),
      form: this.#formsIn(snapshot, view, culture ?? null),
      contentTypeAlias: (key) => snapshot.contentTypeAliases.get(key.toLowerCase()),
      urlOf: (content) => content.url,
      mediaUrlOf: (item) => (item as PublishedMedia).url,
    }
  }

  /** The content in `culture`, or in the default culture. */
  async byKey(key: string, culture?: string | null): Promise<PublishedContent | undefined> {
    const snapshot = await this.snapshot()
    return this.#view(snapshot, culture)?.byKey.get(key.toLowerCase())
  }

  /**
   * The content's URL in each culture it is published in; one invariant entry
   * for invariant content on a site without cultures in play.
   */
  async urls(key: string): Promise<Array<{ culture: string | null; url: string }>> {
    return urlsIn(await this.snapshot(), key).map(({ culture, url }) => ({ culture, url }))
  }

  /** A dictionary item's translation in `culture`, then its fallback languages; '' when none. */
  async dictionary(key: string, culture: string | null): Promise<string> {
    const snapshot = await this.snapshot()
    return translate(snapshot, key, culture)
  }

  async navigation(culture?: string | null): Promise<Navigation> {
    const snapshot = await this.snapshot()
    const view = this.#view(snapshot, culture)
    const byId = view?.byId ?? new Map<number, PublishedContent>()
    const byKey = view?.byKey ?? new Map<string, PublishedContent>()
    const parentIdOf = view?.parentIdOf ?? new Map<number, number>()
    return {
      parent: (content) => {
        const parentId = parentIdOf.get(content.id)
        return parentId === undefined ? undefined : byId.get(parentId)
      },
      children: (content, options) => {
        const children = view?.childrenOf.get(content.id) ?? []
        return options?.visibleOnly ? children.filter((c) => c.isVisible) : children
      },
      ancestors: (content) => {
        const found: PublishedContent[] = []
        let current = content
        for (;;) {
          const parentId = parentIdOf.get(current.id)
          const parent = parentId === undefined ? undefined : byId.get(parentId)
          if (!parent) break
          found.push(parent)
          current = parent
        }
        return found
      },
      root: (options) => {
        const roots = view?.roots ?? []
        return options?.visibleOnly ? roots.filter((c) => c.isVisible) : roots
      },
      byKey: (key) => byKey.get(key.toLowerCase()),
    }
  }

  /** The checkpoint and build time of the snapshot served now; nothing before the first build. */
  served(): { checkpoint: number | undefined; builtAt: Date } | undefined {
    if (this.#snapshot === EMPTY || !this.#snapshot.builtAt) return undefined
    const own = this.#snapshot.checkpoint
    const checkpoint =
      own === undefined || this.#coveredTo === undefined ? own : Math.max(own, this.#coveredTo)
    return { checkpoint, builtAt: this.#snapshot.builtAt }
  }

  /**
   * Records that the snapshot served now also holds everything up to
   * `checkpoint`, because every change since its own left the pages alone: a
   * media change does not rebuild it (story 197). Ignored while it is being
   * rebuilt, when the next one will say for itself.
   */
  covered(checkpoint: number): void {
    if (!this.#loaded || this.#snapshot.checkpoint === undefined) return
    if (checkpoint > (this.#coveredTo ?? this.#snapshot.checkpoint)) this.#coveredTo = checkpoint
  }

  async #build(): Promise<CacheSnapshot> {
    const source = this.#source
    if (source.withSnapshot)
      return source.withSnapshot((scoped, checkpoint) => this.#buildFrom(scoped, checkpoint))
    return this.#buildFrom(source, undefined)
  }

  async #buildFrom(
    source: PublishedContentSource,
    checkpoint: number | undefined,
  ): Promise<CacheSnapshot> {
    const builtAt = new Date()
    const pace = pacer()
    const nodes = await source.loadPublished()
    const domains = (await source.loadDomains?.()) ?? []
    const languages = (await source.loadLanguages?.()) ?? []
    const dictionary = new Map<string, Map<string, string>>()
    const dictionaryOutline = (await source.loadDictionaryOutline?.()) ?? []
    for (const [key, translations] of (await source.loadDictionary?.()) ?? new Map())
      dictionary.set(
        key.toLowerCase(),
        new Map([...translations].map(([culture, text]) => [culture.toLowerCase(), text])),
      )
    const media = this.#mediaLookup()
    const redirects = (await source.loadRedirects?.()) ?? []
    const elementNodes = (await source.loadElements?.()) ?? []
    const contentTypeAliases = new Map(
      [...((await source.loadContentTypeAliases?.()) ?? new Map())].map(([key, alias]) => [
        key.toLowerCase(),
        alias,
      ]),
    )
    const defaultCulture =
      languages.find((l) => l.isDefault)?.isoCode ?? languages[0]?.isoCode ?? null
    const cultures: Array<string | null> =
      languages.length > 0 ? languages.map((l) => l.isoCode) : [null]

    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const domainsOf = new Map<number, PublishedDomain[]>()
    for (const domain of domains)
      if (!domain.isWildcard)
        domainsOf.set(domain.nodeId, [...(domainsOf.get(domain.nodeId) ?? []), domain])

    /** The hostname that roots a node in a culture: one of that culture, else one of none. */
    const domainFor = (nodeId: number, culture: string | null) => {
      const own = domainsOf.get(nodeId) ?? []
      return (
        own.find((d) => viewKey(d.isoCode) === viewKey(culture) && d.isoCode !== null) ??
        own.find((d) => d.isoCode === null) ??
        (viewKey(culture) === viewKey(defaultCulture) ? own[0] : undefined)
      )
    }

    const firstRootId = nodes
      .filter((node) => node.parentId <= 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id
    const { hideTopLevel } = (await source.loadUrlOptions?.()) ?? { hideTopLevel: true }

    const byRoute = new Map<string, PublishedContent>()
    const byDomainRoute = new Map<string, PublishedContent>()
    const views = new Map<string, CultureView>()
    const routeKeys = new Map<string, RouteKey>()
    const domainRoots = new Map<number, string>()
    for (const nodeId of domainsOf.keys()) {
      const key = nodeById.get(nodeId)?.key
      if (key) domainRoots.set(nodeId, key.toLowerCase())
    }

    // `umbracoUrlAlias` routes, claimed only once every real route has been, so an
    // alias can never take an address a page already answers on.
    const aliasClaims: Array<{ content: PublishedContent; route: string; domainKeys: string[] }> =
      []

    for (const culture of cultures) {
      const inCulture = (node: PublishedNode) =>
        node.cultures.length === 0 || node.cultures.some((c) => viewKey(c) === viewKey(culture))
      const nameIn = (node: PublishedNode) => {
        if (node.cultures.length === 0) return node.name
        const found = Object.entries(node.names ?? {}).find(
          ([c]) => viewKey(c) === viewKey(culture),
        )
        return found?.[1] ?? node.name
      }
      const segmentOf = new Map<number, string>()
      for (const node of nodes) {
        await pace()
        if (!inCulture(node)) continue
        const override =
          node.properties.find(
            (p) =>
              p.alias === URL_NAME_ALIAS && viewKey(p.culture) === viewKey(culture) && p.culture,
          ) ?? node.properties.find((p) => p.alias === URL_NAME_ALIAS && p.culture === null)
        segmentOf.set(
          node.id,
          urlSegmentFor(nameIn(node), typeof override?.value === 'string' ? override.value : null),
        )
      }

      // Umbraco gathers a path from the page up and reverses it into root-first
      // order only for a left-to-right culture; a right-to-left one keeps the
      // page's own segment first.
      const rtl = isRightToLeft(culture)
      const inPathOrder = (segments: string[]) => (rtl ? [...segments].reverse() : segments)

      /**
       * Umbraco's default (`HideTopLevelNodeFromPath`): a top-level node's segment
       * is left out of every URL below it, the first top-level node is `/`, and any
       * other is `/<segment>`. With it off, every path starts with its top-level
       * page's segment, the first one's included. A route only exists if every
       * ancestor is also published in the culture — an unpublished ancestor breaks
       * the route rather than leaving a reachable orphan.
       */
      const routeOf = (node: PublishedNode): string | undefined => {
        if (node.parentId <= 0)
          return node.id === firstRootId && hideTopLevel
            ? '/'
            : joinPath([segmentOf.get(node.id) as string])
        const segments: string[] = []
        let current: PublishedNode = node
        for (;;) {
          const parent = nodeById.get(current.parentId)
          if (!parent || !segmentOf.has(parent.id)) return undefined
          segments.unshift(segmentOf.get(current.id) as string)
          if (parent.parentId <= 0) {
            if (!hideTopLevel) segments.unshift(segmentOf.get(parent.id) as string)
            break
          }
          current = parent
        }
        return joinPath(inPathOrder(segments))
      }

      /** The route below the nearest document with a hostname for this culture, if there is one. */
      const domainRouteOf = (
        node: PublishedNode,
      ): { domain: PublishedDomain; route: string } | undefined => {
        const segments: string[] = []
        let current: PublishedNode | undefined = node
        while (current && segmentOf.has(current.id)) {
          const domain = domainFor(current.id, culture)
          if (domain) return { domain, route: joinPath(inPathOrder(segments)) }
          segments.unshift(segmentOf.get(current.id) as string)
          current = nodeById.get(current.parentId)
        }
        return undefined
      }

      const view: CultureView = {
        culture,
        byId: new Map(),
        byKey: new Map(),
        elements: new Map(),
        childrenOf: new Map(),
        roots: [],
        parentIdOf: new Map(),
      }
      const isDefault = viewKey(culture) === viewKey(defaultCulture)
      // Shallow and first-sorted nodes claim a route before any that collide with it.
      const ordered = [...nodes]
        .filter(inCulture)
        .sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder)
      for (const node of ordered) {
        await pace()
        const route = routeOf(node)
        if (route === undefined) continue
        const domainRoute = domainRouteOf(node)
        const variant = node.cultures.length > 0
        const url = domainRoute
          ? `//${domainRoute.domain.domainName}${domainRoute.route === '/' ? '/' : domainRoute.route}`
          : isDefault || !variant
            ? route
            : '#'
        const content = new PublishedContent({
          key: node.key,
          id: node.id,
          name: nameIn(node),
          contentTypeAlias: node.contentTypeAlias,
          urlSegment: segmentOf.get(node.id) as string,
          url,
          level: node.level,
          path: node.path,
          sortOrder: node.sortOrder,
          createDate: node.createDate,
          updateDate: node.updateDate,
          componentAlias: node.componentAlias,
          cultures: node.cultures,
          properties: node.properties,
          variationCulture: variant ? culture : null,
          languageFallback: fallbackChain(languages, culture),
        })
        view.byId.set(node.id, content)
        view.byKey.set(node.key.toLowerCase(), content)
        for (const alias of urlAliasesOf(node, culture)) {
          const domainKeys = domainRoute
            ? (domainsOf.get(domainRoute.domain.nodeId) ?? [])
                .filter((d) =>
                  d.isoCode === null ? isDefault : viewKey(d.isoCode) === viewKey(culture),
                )
                .map((d) => `${d.domainName}:${alias}`)
            : []
          aliasClaims.push({ content, route: isDefault ? alias : '', domainKeys })
        }
        routeKeys.set(
          routeKeyId(culture, node.id),
          domainRoute
            ? {
                rootKey: domainRoots.get(domainRoute.domain.nodeId) ?? null,
                path: normaliseRoute(domainRoute.route),
              }
            : { rootKey: null, path: normaliseRoute(route) },
        )
        if (isDefault && !byRoute.has(route.toLowerCase()))
          byRoute.set(route.toLowerCase(), content)
        // With the top level shown the home page's URL is its own segment, but `/`
        // still has to answer with it.
        if (!hideTopLevel && isDefault && node.id === firstRootId && !domainRoute)
          byRoute.set('/', content)
        // Every hostname on the rooting document serves its own culture's view;
        // one with no culture serves the default's
        if (domainRoute)
          for (const domain of domainsOf.get(domainRoute.domain.nodeId) ?? []) {
            const serves =
              domain.isoCode === null ? isDefault : viewKey(domain.isoCode) === viewKey(culture)
            const key = `${domain.domainName}:${domainRoute.route.toLowerCase()}`
            if (serves && !byDomainRoute.has(key)) byDomainRoute.set(key, content)
          }
        if (nodeById.has(node.parentId) && segmentOf.has(node.parentId)) {
          view.parentIdOf.set(node.id, node.parentId)
          const siblings = view.childrenOf.get(node.parentId) ?? []
          siblings.push(content)
          view.childrenOf.set(node.parentId, siblings)
        } else {
          view.roots.push(content)
        }
      }
      for (const siblings of view.childrenOf.values())
        siblings.sort((a, b) => a.sortOrder - b.sortOrder)
      view.roots.sort((a, b) => a.sortOrder - b.sortOrder)

      // Pickers and links resolve against this culture's view.
      const context: ValueContext<PublishedContent, PublishedMedia> = {
        content: (key) => view.byKey.get(key.toLowerCase()),
        media,
        // Read lazily: the map is filled just below, with this very context, so an
        // element picking another element resolves too.
        element: (key) => view.elements.get(key.toLowerCase()),
        form: this.#formsIn(
          { dictionary, dictionaryOutline, languages, defaultCulture },
          view,
          culture,
        ),
        contentTypeAlias: (key) => contentTypeAliases.get(key.toLowerCase()),
        urlOf: (content) => content.url,
        mediaUrlOf: (item) => item.url,
      }
      // An invariant element is visible in every culture; a varying one only in the
      // cultures it is published in. Built with this culture's context, so a
      // property inside an element resolves pickers within the same culture.
      for (const node of elementNodes) {
        if (node.cultures.length > 0 && !node.cultures.some((c) => viewKey(c) === viewKey(culture)))
          continue
        view.elements.set(
          node.key.toLowerCase(),
          new PublishedElement(
            {
              key: node.key,
              contentTypeKey: node.contentTypeKey,
              contentTypeAlias: node.contentTypeAlias,
              properties: node.properties,
            },
            context,
          ),
        )
      }

      for (const content of view.byId.values()) {
        await pace()
        content.withValueContext(context)
        // Ancestors are wired after every node exists, for the `ancestors` fallback.
        const ancestors: PublishedContent[] = []
        let currentId = view.parentIdOf.get(content.id)
        while (currentId !== undefined) {
          const parent = view.byId.get(currentId)
          if (!parent) break
          ancestors.push(parent)
          currentId = view.parentIdOf.get(parent.id)
        }
        content.withAncestors(ancestors)
      }
      views.set(viewKey(culture), view)
    }

    for (const claim of aliasClaims) {
      if (claim.route && !byRoute.has(claim.route)) byRoute.set(claim.route, claim.content)
      for (const key of claim.domainKeys)
        if (!byDomainRoute.has(key)) byDomainRoute.set(key, claim.content)
    }

    return {
      views,
      defaultCulture,
      hideTopLevel,
      byRoute,
      byDomainRoute,
      domains,
      domainRoots,
      routeKeys,
      redirects,
      languages,
      dictionary,
      dictionaryOutline,
      contentTypeAliases,
      ...(checkpoint === undefined ? {} : { checkpoint }),
      builtAt,
    }
  }

  #mediaLookup(): (key: string) => Promise<PublishedMedia | undefined> {
    const media = this.#options.media
    return media ? (key) => media.byKey(key) : NO_MEDIA
  }

  /** Form lookups whose source-backed choices resolve against this view and culture. */
  #formsIn(
    snapshot: ChoiceSnapshot,
    view: CultureView | undefined,
    culture: string | null,
  ): ((key: string) => SchemaForm | undefined) | undefined {
    const lookup = this.#options.form
    if (!lookup) return undefined
    return (key) => {
      const form = lookup(key)
      return form
        ? withResolvedChoices(form, (source) => resolveChoices(snapshot, view, culture, source))
        : undefined
    }
  }

  /** What a choice source offers now, in `culture`: for the designer, and for a submission. */
  async choiceOptions(source: ChoiceSource, culture?: string | null): Promise<ChoiceOption[]> {
    const snapshot = await this.snapshot()
    return resolveChoices(snapshot, this.#view(snapshot, culture), culture ?? null, source)
  }

  /** The form with its source-backed choices resolved, as a page in `culture` would render it. */
  /**
   * What drawing forms from data needs, synchronously once the snapshot is in
   * hand: a form with its choice sources filled in, and a page's address.
   */
  async formTools(culture?: string | null): Promise<{
    resolve(form: SchemaForm): SchemaForm
    urlOf(key: string): string | undefined
  }> {
    const snapshot = await this.snapshot()
    const view = this.#view(snapshot, culture)
    return {
      resolve: (form) =>
        withResolvedChoices(form, (source) =>
          resolveChoices(snapshot, view, culture ?? null, source),
        ),
      urlOf: (key) => {
        const url = view?.byKey.get(key.toLowerCase())?.url
        return url && url !== '#' ? url : undefined
      },
    }
  }

  async resolveForm(form: SchemaForm, culture?: string | null): Promise<SchemaForm> {
    const snapshot = await this.snapshot()
    const view = this.#view(snapshot, culture)
    return withResolvedChoices(form, (source) =>
      resolveChoices(snapshot, view, culture ?? null, source),
    )
  }
}

type ChoiceSnapshot = Pick<
  CacheSnapshot,
  'dictionary' | 'dictionaryOutline' | 'languages' | 'defaultCulture'
>

/**
 * A choice source's options: a published page's children by key and name, or a
 * dictionary item's children by key and translation. Nothing when the parent is gone.
 */
export function resolveChoices(
  snapshot: ChoiceSnapshot,
  view: CultureView | undefined,
  culture: string | null,
  source: ChoiceSource,
): ChoiceOption[] {
  if (source.kind === 'content') {
    const parent = view?.byKey.get(source.parent.toLowerCase())
    if (!parent || !view) return []
    return (view.childrenOf.get(parent.id) ?? []).map((child) => ({
      value: child.key,
      label: child.name,
    }))
  }
  if (source.kind === 'dictionary') {
    const parent = source.parent.toLowerCase()
    return snapshot.dictionaryOutline
      .filter((item) => item.parentName?.toLowerCase() === parent)
      .map((item) => ({
        value: item.key,
        label: translate(snapshot, item.name, culture) || item.name,
      }))
  }
  return []
}

/**
 * A document's address in each culture it is published in, or its one address
 * when it does not vary; `isDefault` marks the default language's.
 */
export function urlsIn(
  snapshot: CacheSnapshot,
  key: string,
): Array<{ culture: string | null; url: string; isDefault: boolean }> {
  const out: Array<{ culture: string | null; url: string; isDefault: boolean }> = []
  let invariant: PublishedContent | undefined
  for (const view of snapshot.views.values()) {
    const content = view.byKey.get(key.toLowerCase())
    if (!content) continue
    if (content.cultures.length === 0) invariant ??= content
    else
      out.push({
        culture: view.culture,
        url: content.url,
        isDefault: viewKey(view.culture) === viewKey(snapshot.defaultCulture),
      })
  }
  if (out.length === 0 && invariant) return [{ culture: null, url: invariant.url, isDefault: true }]
  return out
}

/** A property's raw value in a culture: the culture's own first, then the invariant one. */
function rawValueIn(node: PublishedNode, alias: string, culture: string | null): unknown {
  return (
    node.properties.find(
      (p) => p.alias === alias && p.culture && viewKey(p.culture) === viewKey(culture),
    ) ?? node.properties.find((p) => p.alias === alias && p.culture === null)
  )?.value
}

/**
 * The extra addresses `umbracoUrlAlias` gives a page: comma-separated, each
 * relative to the site root or to the hostname that roots the page.
 */
function urlAliasesOf(node: PublishedNode, culture: string | null): string[] {
  const value = rawValueIn(node, URL_ALIAS_ALIAS, culture)
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0)
    .map((alias) => normaliseRoute(alias.startsWith('/') ? alias : `/${alias}`).toLowerCase())
}

/** The content below `content` in one culture's view, breadth first. */
function descendantsOf(view: CultureView, content: PublishedContent): PublishedContent[] {
  const out: PublishedContent[] = []
  const queue = [content]
  while (queue.length > 0) {
    const next = queue.shift() as PublishedContent
    for (const child of view.childrenOf.get(next.id) ?? []) {
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/** A dictionary item's translation in `culture`, then its fallback languages; '' when none. */
export function translate(
  snapshot: Pick<CacheSnapshot, 'dictionary' | 'languages' | 'defaultCulture'>,
  key: string,
  culture: string | null,
): string {
  const item = snapshot.dictionary.get(key.toLowerCase())
  if (!item) return ''
  const wanted = culture ?? snapshot.defaultCulture
  for (const c of [wanted, ...fallbackChain(snapshot.languages, wanted)]) {
    const text = c ? item.get(c.toLowerCase()) : undefined
    if (text) return text
  }
  return ''
}

/** A model for one node outside the cache, such as a draft in preview. */
export function contentForNode(
  node: PublishedNode,
  url: string,
  culture: string | null = null,
  languages: readonly PublishedLanguage[] = [],
): PublishedContent {
  const variant = node.cultures.length > 0
  const scoped = variant ? (culture ?? node.cultures[0] ?? null) : null
  const name =
    (scoped &&
      Object.entries(node.names ?? {}).find(([c]) => viewKey(c) === viewKey(scoped))?.[1]) ||
    node.name
  const override =
    node.properties.find(
      (p) => p.alias === URL_NAME_ALIAS && p.culture && viewKey(p.culture) === viewKey(scoped),
    ) ??
    node.properties.find(
      (property) => property.alias === URL_NAME_ALIAS && property.culture === null,
    )
  return new PublishedContent({
    key: node.key,
    id: node.id,
    name,
    contentTypeAlias: node.contentTypeAlias,
    urlSegment: urlSegmentFor(name, typeof override?.value === 'string' ? override.value : null),
    url,
    level: node.level,
    path: node.path,
    sortOrder: node.sortOrder,
    createDate: node.createDate,
    updateDate: node.updateDate,
    componentAlias: node.componentAlias,
    cultures: node.cultures,
    properties: node.properties,
    variationCulture: scoped,
    languageFallback: fallbackChain(languages, scoped),
  })
}
