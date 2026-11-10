/**
 * Front-end rendering: resolve a URL to published content, find its template, and
 * execute it.
 *
 * A template is a .tsx module whose default export is a function of PageProps.
 * `export const layout = 'alias'` names the layout template, which is how Umbraco
 * declares it too — in the file, not the database.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type FormSubmissionState, isOutcome, type Outcome } from '@crombolo/core'
import { componentStackOf, trackComponent } from './component-stack.ts'
import { emailScope, markPersonal, type PageActions, renderScope } from './context.ts'
import {
  DEFERRED_TAGS,
  type DeferredRequest,
  type DeferredScope,
  isDeferredSource,
} from './deferred.ts'
import type { EmailProps, EmailRenderResult } from './email.ts'
import { RawHtml } from './html.ts'
import { beforeBodyEnd, ISLANDS_PATH, withIslandTags } from './islands.ts'
import { type Child, renderToString } from './jsx-runtime.ts'
import type {
  PageOutcome,
  PageProps,
  PublishedContent,
  RequestMember,
  SearchParams,
} from './model.ts'
import { type PublishedCache, translate, urlsIn } from './published-cache.ts'
import type { SiteSearchPort } from './search.ts'
import { absoluteUrl, type Metadata, type SeoSiteDefaults } from './seo.ts'
import type { ViewSnapshots } from './snapshots.ts'

export interface ComponentModule {
  default: (props: PageProps) => Child | Promise<Child>
  /** Alias of the layout template to wrap this one in. */
  layout?: string
  /**
   * As Next.js's route segment config: `force-dynamic` is always personal;
   * `force-static` empties the request's values so the page can be shared.
   */
  dynamic?: 'auto' | 'force-dynamic' | 'force-static'
  /** Seconds copies of the page may be kept, or false for as long as it is unchanged. */
  revalidate?: number | false
  /** Search and sharing values worked out per request, laid over the page's own. */
  generateMetadata?: (props: PageProps) => Metadata | Promise<Metadata>
}

// biome-ignore lint/suspicious/noExplicitAny: an untyped page, as `PageProps` defaults to.
export interface LayoutProps<Properties = any> extends PageProps<Properties> {
  children: RawHtml
}

export interface RenderOptions {
  cache: PublishedCache
  componentsDir: string
  /**
   * Content-addressed copies of `componentsDir` to import from.
   *
   * Without one the renderer imports straight from `componentsDir`, which is what a
   * unit test wants and means an edited view is not picked up until the process
   * restarts — see `snapshots.ts` for why.
   */
  snapshots?: ViewSnapshots
  /** How long a page may take to render, layouts included; 0 for no limit. */
  renderTimeoutMs?: number
  /**
   * Where a page's island code is described, for the generation it rendered
   * with (story 209); by default the generation's own build.
   */
  islandsManifest?: (generation: string | undefined) => string | undefined
  /**
   * Components an extension owns (story 312): `<id>/<name>`, or a block's
   * `blocks/<alias>`, where the site has none of its own. Each renders in the
   * extension's process.
   */
  extensionComponents?: { module(alias: string): ComponentModule | undefined }
}

export const DEFAULT_RENDER_TIMEOUT_MS = 10_000

/** What a rendered page says about how its answer may be kept. */
export interface RenderedCaching {
  /** It read something that depends on who is asking, so it is never shared. */
  personal: boolean
  /** The template's own `revalidate`, overriding its type's and the site's lifetime. */
  revalidate?: number | false
  /**
   * The view files it rendered that mention `member` (story 263): the page
   * depends on who is signed in, and is shared only with signed-out visitors.
   */
  memberFiles?: string[]
}

export type RenderResult =
  | ({ status: 'ok'; html: string; content: PublishedContent } & RenderedCaching)
  /** A component threw a redirect or a refusal (story 206). */
  | ({ status: 'outcome'; outcome: Outcome; content: PublishedContent } & RenderedCaching)
  | { status: 'notFound' }
  /** The page names another to send its visitors to (`umbracoRedirect`). */
  | { status: 'redirect'; location: string; content: PublishedContent }
  | { status: 'noTemplate'; content: PublishedContent }
  | { status: 'error'; error: Error; content: PublishedContent }

const MAX_LAYOUT_DEPTH = 10

/** Why a finished render's signal is aborted: whatever still listens can let go. */
const RENDERED = new Error('The page has rendered.')

/**
 * A whole document gets `<!DOCTYPE html>`, which JSX has no way to write and
 * without which a browser renders in quirks mode. A page that writes its own,
 * or renders something other than a document, is left as it is.
 */
export function withDoctype(html: string): string {
  return /^\s*<html[\s>]/i.test(html) ? `<!DOCTYPE html>${html}` : html
}
/** Umbraco's own guard against a login page that is itself protected. */
const MAX_ACCESS_SUBSTITUTIONS = 8

/**
 * What a public-access check decides for a page: render it, or render another
 * one in its place — the login page for a visitor who is not signed in, the
 * error page for a member who may not see it. Umbraco rewrites rather than
 * redirects, so the URL the visitor asked for is the URL they keep.
 */
export type AccessDecision = { status: 'allowed' } | { status: 'substitute'; contentKey: string }

/** Per-request context: who is asking, and what they are allowed to see. */
export interface RenderRequest {
  member?: RequestMember
  access?: (content: PublishedContent) => Promise<AccessDecision>
  /**
   * A form submission the server has just handled, for this request's page.
   *
   * The endpoint redirects back here rather than answering with markup of its
   * own, so the form reappears with its errors — or its thank-you — inside the
   * layout it was rendered in.
   */
  submission?: FormSubmissionState
  /** Scheme and host the visitor used, for absolute addresses; `http://localhost` when absent. */
  origin?: string
  /** The address requested, as the visitor sent it. */
  url?: string
  /** Site-wide search and sharing values. */
  seo?: SeoSiteDefaults
  /** Aborts when nobody is waiting for the page any more: the visitor disconnected. */
  signal?: AbortSignal
  /** Site search scoped to whoever is asking, for `search()`. */
  search?: SiteSearchPort
  /** A back-office preview of a draft: blocks with no component say so (story 184). */
  preview?: boolean
  /** The signed-in member's anti-forgery token, written by `<AntiforgeryMeta />` (story 186). */
  antiforgery?: string
  /** The site's server actions, and what one answered the visitor with (story 219). */
  actions?: PageActions
  /** The request's headers, cookies among them, for `cookies()` and `headers()` (story 206). */
  headers?: Headers
  /** The site's services as whoever is asking, for `site()`. */
  site?: () => unknown
  /** On a status page, the outcome it is answering, for `usePage().outcome`. */
  outcome?: PageOutcome
  /** Signs a `'use deferred'` part's address; without it, parts render in place (story 263). */
  signDeferred?: (data: string) => string
  /** Renders only this part of the page, for its own request. */
  part?: DeferredRequest
}

/** The query string as Next.js hands it to a page: a name given twice becomes an array. */
function queryOf(url: string): SearchParams {
  const query: SearchParams = {}
  let params: URLSearchParams
  try {
    params = new URL(url).searchParams
  } catch {
    return query
  }
  for (const [name, value] of params) {
    const seen = query[name]
    query[name] =
      seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value]
  }
  return query
}

/**
 * The query as a promise that marks the page personal once anything awaits it.
 * Handing the promise on, as spreading a page's props does, marks nothing. A
 * subclass, because `await` on a plain promise never calls its own `then`.
 */
class PersonalPromise<T> extends Promise<T> {
  static override get [Symbol.species]() {
    return Promise
  }
  // biome-ignore lint/suspicious/noThenProperty: marking the read is the point of it.
  override then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    markPersonal()
    return super.then(onFulfilled, onRejected)
  }
}

function personalPromise(query: SearchParams): Promise<SearchParams> {
  return new PersonalPromise<SearchParams>((resolve) => resolve(query))
}

/**
 * Whether an alias is a path that stays inside the components tree.
 *
 * `@crombolo/server` has the same rule as `isSafeAlias`; it is written again
 * here because render does not depend on server, and the two are checked
 * against each other in the suite.
 */
function isSafeComponentAlias(alias: string): boolean {
  if (alias.length === 0 || alias.startsWith('/') || alias.includes('\\')) return false
  if (/^[a-zA-Z]:/.test(alias)) return false
  return alias.split('/').every((part) => /^[A-Za-z0-9_-]+$/.test(part))
}

export class Renderer {
  #cache: PublishedCache
  #componentsDir: string
  #snapshots: ViewSnapshots | undefined
  /** Keyed by the generation that holds the view, so one swap retires them all. */
  #modules = new Map<string, ComponentModule>()
  #importedFrom: string | undefined
  /** Per view file in the current generation: the files it or its imports have that mention `member`. */
  #memberFiles = new Map<string, string[]>()
  #renderTimeoutMs: number
  #islandsManifest: (generation: string | undefined) => string | undefined

  #extensionComponents: RenderOptions['extensionComponents']

  constructor(options: RenderOptions) {
    this.#cache = options.cache
    // Resolved to an absolute path: a dynamic import of a relative specifier
    // resolves against this module, not the working directory.
    this.#componentsDir = resolve(options.componentsDir)
    this.#snapshots = options.snapshots
    this.#renderTimeoutMs = options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS
    this.#extensionComponents = options.extensionComponents
    this.#islandsManifest =
      options.islandsManifest ??
      ((generation) => (generation ? `${ISLANDS_PATH}/${generation}/manifest.json` : undefined))
  }

  /**
   * Drops this renderer's own map of views.
   *
   * On its own this changes nothing about what renders: the module registry
   * behind `import()` belongs to the runtime, so re-importing one path hands
   * back the same module whatever this map holds. What makes an edited view be
   * read is a snapshot at a new path.
   */
  invalidate(): void {
    this.#modules.clear()
  }

  /**
   * Where views are imported from now: a snapshot when there is one.
   *
   * A generation change clears this renderer's map. The runtime's registry keeps
   * the old modules either way, but holding our own references to generations
   * nobody renders would grow without limit.
   */
  #importDir(): string {
    const dir = this.#snapshots?.directory() ?? this.#componentsDir
    if (dir !== this.#importedFrom) {
      this.#modules.clear()
      this.#memberFiles.clear()
      this.#importedFrom = dir
    }
    return dir
  }

  /**
   * The files among `file` and what it imports from the views that mention
   * `member` (story 263). Read once per file per generation. A deferred part's
   * own source is left out, as it renders in its own request, and so is any
   * package, whose code cannot be read here.
   */
  #filesMentioningMember(file: string, seen = new Set<string>()): string[] {
    const known = this.#memberFiles.get(file)
    if (known) return known
    if (seen.has(file) || isDeferredSource(file)) return []
    seen.add(file)
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      return []
    }
    const found: string[] = []
    try {
      if (/\bmember\b/.test(viewTranspiler.transformSync(source))) found.push(file)
      for (const { path } of viewTranspiler.scanImports(source)) {
        if (!path.startsWith('.')) continue
        const target = resolveView(join(dirname(file), path))
        if (target) found.push(...this.#filesMentioningMember(target, seen))
      }
    } catch {
      // A file that does not parse fails its render, which says so.
      found.push(file)
    }
    const unique = [...new Set(found)]
    this.#memberFiles.set(file, unique)
    return unique
  }

  /** A view file as a person reads it: `components/shared/layout.tsx`. */
  #shownPath(file: string): string {
    const dir = this.#importedFrom ?? this.#componentsDir
    return `${basename(this.#componentsDir)}/${relative(dir, file).split(sep).join('/')}`
  }

  /**
   * The file a view is imported from, inside the current generation.
   *
   * Not the file anybody edits — that is `sourceFor`, and the two differ by the
   * generation in between.
   */
  componentPath(alias: string): string | undefined {
    // An alias is a path under `components/`, so it may carry folders — but it
    // reaches here from the database, and a path from the database is a path
    // from a request. Each segment is checked rather than the whole string, so
    // `..`, an absolute path and a drive letter are all refused while
    // `pages/homePage` resolves.
    if (!isSafeComponentAlias(alias)) return undefined
    const dir = this.#importDir()
    // A template may be a folder, as a Next.js route is, so its partials sit beside it.
    for (const file of [join(dir, `${alias}.tsx`), join(dir, alias, 'page.tsx')])
      if (existsSync(file)) return file
    return undefined
  }

  /**
   * Rewrites snapshot paths back to `componentsDir`, for anything a person reads: an
   * error, a log line, a stack trace. A snapshot names a directory nobody edits
   * and a generation they cannot act on, so naming it would send them to the
   * wrong file.
   *
   * Every generation, not just the current one: a stack can name a module loaded
   * from the generation before a swap.
   */
  inSource(text: string): string {
    const cacheDir = this.#snapshots?.cacheDir
    if (!cacheDir) return text
    const escaped = cacheDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.replaceAll(new RegExp(`${escaped}[/\\\\][0-9a-f]+`, 'g'), this.#componentsDir)
  }

  /** Renders the page a request resolves to; `host` lets hostnames root and localise it. */
  async render(route: string, host = '', request: RenderRequest = {}): Promise<RenderResult> {
    const resolved = await this.#cache.resolve(host, route)
    if (!resolved) return { status: 'notFound' }
    const { culture } = resolved
    if (resolved.redirect)
      return { status: 'redirect', location: resolved.redirect, content: resolved.content }
    const permitted = await this.#permitted(resolved.content, culture, request)
    if (!permitted) return { status: 'notFound' }
    const content = permitted
    if (!content.componentAlias) return { status: 'noTemplate', content }

    return this.#renderPage(content, content.componentAlias, culture, request)
  }

  /**
   * The page to render in place of this one, following the access check until it
   * is satisfied. Undefined means nothing can be shown — a rule naming a page
   * that no longer exists, which is a 404 rather than an open door.
   */
  async #permitted(
    content: PublishedContent,
    culture: string | null,
    request: RenderRequest,
  ): Promise<PublishedContent | undefined> {
    if (!request.access) return content
    let current = content
    for (let step = 0; step < MAX_ACCESS_SUBSTITUTIONS; step++) {
      const decision = await request.access(current)
      if (decision.status === 'allowed') return current
      if (decision.contentKey.toLowerCase() === current.key.toLowerCase()) return undefined
      const next = await this.#cache.byKey(decision.contentKey, culture)
      if (!next) return undefined
      current = next
    }
    return undefined
  }

  /**
   * Renders a given model rather than a routed one: preview renders a draft this
   * way, with the published tree for navigation.
   */
  async renderModel(
    content: PublishedContent,
    culture: string | null,
    request: RenderRequest = {},
  ): Promise<RenderResult> {
    if (!content.componentAlias) return { status: 'noTemplate', content }
    return this.#renderPage(content, content.componentAlias, culture, request)
  }

  async #renderPage(
    content: PublishedContent,
    alias: string,
    culture: string | null,
    request: RenderRequest,
  ): Promise<RenderResult> {
    const caching: RenderedCaching = { personal: false }
    try {
      const html = await this.#withDeadline(alias, request.signal, (signal, rendering) =>
        this.#renderChain(content, alias, culture, request, signal, rendering, caching),
      )
      return html === undefined
        ? { status: 'noTemplate', content }
        : { status: 'ok', html, content, ...caching }
    } catch (error) {
      if (isOutcome(error)) return { status: 'outcome', outcome: error, content, ...caching }
      return { status: 'error', error: error as Error, content }
    }
  }

  /**
   * Renders an e-mail template to HTML: resolved in the current views as a
   * page's template is, under the same time limit, inside its layouts.
   *
   * Never throws. A failure comes back as a message a person can act on, naming
   * the template and the line under `components/` it failed on.
   */
  async renderEmail(alias: string, props: Omit<EmailProps, 'signal'>): Promise<EmailRenderResult> {
    if (!this.componentPath(alias)) return { status: 'missing' }
    try {
      const html = await this.#withDeadline(alias, undefined, (signal, rendering) =>
        emailScope(() => this.#renderLayouts(alias, { ...props, signal }, rendering)),
      )
      return html === undefined ? { status: 'missing' } : { status: 'ok', html }
    } catch (error) {
      return { status: 'error', message: this.#emailFailure(alias, error) }
    }
  }

  /** `The e-mail template 'x' failed at components/x.tsx:12: <what it threw>`. */
  #emailFailure(alias: string, error: unknown): string {
    const { message, location } = this.describeError(error)
    return `The e-mail template '${alias}' failed${location ? ` at ${location}` : ''}: ${message}`
  }

  /**
   * What a template threw, for a person to act on: its message, the first line
   * under `components/` it failed on with the code around it, the component
   * stack where one was recorded, and the stack, all naming files somebody can
   * open.
   */
  describeError(error: unknown): ErrorDescription {
    const root = `${this.#componentsDir}${sep}`
    const shown = `${basename(this.#componentsDir)}/`
    const readable = (text: string) => this.inSource(text).replaceAll(root, shown)
    const message = readable(error instanceof Error ? error.message : String(error)).trim()
    const stack = error instanceof Error ? readable(error.stack ?? '') : ''
    const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const frame = new RegExp(`${escaped}([^\\s:()]+\\.[jt]sx?):(\\d+)`).exec(stack)
    const components = componentStackOf(error)
    return {
      message,
      stack,
      ...(frame ? { location: frame[0] } : {}),
      ...(frame ? codeAround(this.#componentsDir, frame[1] as string, Number(frame[2])) : {}),
      ...(components ? { components } : {}),
    }
  }

  /** Runs a render under the time limit; the signal it hands on aborts when that runs out. */
  async #withDeadline<T>(
    alias: string,
    outer: AbortSignal | undefined,
    render: (signal: AbortSignal, rendering: { alias: string }) => Promise<T>,
  ): Promise<T> {
    const deadline = new AbortController()
    const signal = outer ? AbortSignal.any([deadline.signal, outer]) : deadline.signal
    const rendering = { alias }
    const timer =
      this.#renderTimeoutMs > 0
        ? setTimeout(
            () =>
              deadline.abort(
                new Error(
                  `Rendering '${rendering.alias}' took longer than ${this.#renderTimeoutMs}ms.`,
                ),
              ),
            this.#renderTimeoutMs,
          )
        : undefined
    let fail = () => {}
    const stopped = new Promise<never>((_, reject) => {
      fail = () => reject(signal.reason)
      if (signal.aborted) fail()
      else signal.addEventListener('abort', fail, { once: true })
    })
    stopped.catch(() => {})
    const work = render(signal, rendering)
    // Once the deadline has answered, a late failure has nobody left to tell.
    work.catch(() => {})
    try {
      return await Promise.race([work, stopped])
    } finally {
      clearTimeout(timer)
      // Bun keeps an `AbortSignal.any` signal, its sources and all they reach
      // alive while anything listens to it, so every render would be kept.
      signal.removeEventListener('abort', fail)
      deadline.abort(RENDERED)
    }
  }

  async #renderChain(
    content: PublishedContent,
    alias: string,
    culture: string | null,
    request: RenderRequest,
    signal: AbortSignal,
    rendering: { alias: string },
    caching: RenderedCaching,
  ): Promise<string | undefined> {
    const used = new Set<string>()
    const page = await this.#load(alias, used)
    if (!page) return undefined
    const dynamic = page.dynamic ?? 'auto'
    const shared = dynamic === 'force-static'
    if (typeof page.revalidate === 'number' || page.revalidate === false)
      caching.revalidate = page.revalidate
    // A static page reads nothing of the request, so what it marks is thrown away.
    const personal = { value: dynamic === 'force-dynamic' }
    const member = shared ? undefined : request.member
    const nav = await this.#cache.navigation(culture)
    const snapshot = await this.#cache.snapshot()
    const dictionary = (key: string) => translate(snapshot, key, culture)
    // Menus are few, so all of them are read now, their media in one lookup,
    // and `menu()` stays synchronous for the views.
    const menus = await this.#cache.menus(culture)
    const menu = (alias: string) => menus.get(alias.trim().toLowerCase())?.items ?? []
    const root = nav.ancestors(content).at(-1) ?? content
    const settings = (await this.#cache.settings(root.key, culture)) ?? null
    const origin = (request.origin ?? 'http://localhost').replace(/\/$/, '')
    const props: PageProps = {
      model: content,
      nav,
      culture,
      dictionary,
      menu,
      settings,
      member,
      submission: request.submission,
      request: { origin, url: request.url ?? `${origin}/` },
      searchParams: shared
        ? Promise.resolve({})
        : personalPromise(queryOf(request.url ?? `${origin}/`)),
      outcome: request.outcome,
      urls: {
        absolute: (target) => absoluteUrl(target.url, origin),
        alternates: (target) => urlsIn(snapshot, target.key),
      },
      seo: request.seo ?? { siteName: '', indexable: true },
      signal,
    }

    const metadata: { value?: Metadata } = {}
    const islands = { used: false }
    const deferred: DeferredScope | undefined = request.signDeferred
      ? { inPart: request.part !== undefined, sign: request.signDeferred, used: false }
      : undefined
    // Inside the page's scope, so any component can ask for it with `usePage()`.
    try {
      const html = await renderScope(
        props,
        async () => {
          if (request.part) return this.#renderPart(request.part)
          if (page.generateMetadata) metadata.value = await page.generateMetadata(props)
          return this.#renderLayouts(alias, props, rendering, used)
        },
        {
          search: request.search,
          preview: request.preview,
          antiforgery: request.antiforgery,
          blockComponent: (blockAlias) => this.blockComponent(blockAlias, used),
          extensionComponent: (use) =>
            this.#extensionComponents?.module(use)?.default as
              | ((props: object) => Child | Promise<Child>)
              | undefined,
          request: { headers: shared ? new Headers() : (request.headers ?? new Headers()) },
          site: request.site,
          personal: shared ? { value: false } : personal,
          metadata,
          islands,
          actions: request.actions,
          deferred,
        },
      )
      if (html === undefined || request.part) return html
      const withParts = deferred?.used ? beforeBodyEnd(html, DEFERRED_TAGS) : html
      if (!islands.used) return withParts
      // The generation the views were imported from, so the page loads the code built with them.
      const manifest = this.#islandsManifest(
        this.#importedFrom && this.#snapshots ? basename(this.#importedFrom) : undefined,
      )
      return manifest ? withIslandTags(withParts, manifest) : withParts
    } finally {
      const files = [...new Set([...used].flatMap((file) => this.#filesMentioningMember(file)))]
      if (files.length > 0) caching.memberFiles = files.map((file) => this.#shownPath(file))
      caching.personal = !shared && (personal.value || (member !== undefined && files.length > 0))
    }
  }

  /** A `'use deferred'` part alone, for its own request: its module's export, rendered in place. */
  async #renderPart(part: DeferredRequest): Promise<string | undefined> {
    const segments = part.module.split('/')
    const safe =
      /\.[jt]sx?$/.test(part.module) &&
      segments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment) && !/^\.+$/.test(segment))
    if (!safe) return undefined
    const file = join(this.#importDir(), ...segments)
    if (!existsSync(file)) return undefined
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    const render = module[part.exportName]
    if (typeof render !== 'function') return undefined
    return renderToString((render as (props: object) => Child)({ ...part.props }))
  }

  /** Generic over its props: a page's, or an e-mail's. */
  async #renderLayouts<Props extends object>(
    alias: string,
    props: Props,
    rendering: { alias: string },
    used?: Set<string>,
  ): Promise<string | undefined> {
    let currentAlias: string | undefined = alias
    let body: RawHtml | undefined
    let depth = 0

    // Walk the layout chain outwards: the page renders first, then each layout
    // wraps the result. A cycle would otherwise hang the request.
    while (currentAlias && depth < MAX_LAYOUT_DEPTH) {
      rendering.alias = currentAlias
      const module = await this.#load(currentAlias, used)
      if (!module) return depth === 0 || body === undefined ? undefined : withDoctype(body.value)
      const render = module.default as unknown as (props: object) => Child | Promise<Child>
      const layoutProps = body === undefined ? props : { ...props, children: body }
      body = new RawHtml(
        await trackComponent(currentAlias, () => renderToString(render(layoutProps) as Child)),
      )
      currentAlias = module.layout
      depth += 1
    }
    if (depth >= MAX_LAYOUT_DEPTH) {
      throw new Error(
        `Layout chain for '${alias}' is longer than ${MAX_LAYOUT_DEPTH}; is it a cycle?`,
      )
    }
    return body === undefined ? undefined : withDoctype(body.value)
  }

  /**
   * A block's component (story 184): `components/blocks/<alias>.tsx` and
   * nowhere else. The alias is one plain segment, so an element type alias can
   * never reach outside `blocks/`.
   */
  async blockComponent(alias: string, used?: Set<string>) {
    if (!/^[A-Za-z0-9_-]+$/.test(alias)) return undefined
    const module = await this.#load(`blocks/${alias}`, used)
    return module?.default as ((props: never) => Child | Promise<Child>) | undefined
  }

  async #load(alias: string, used?: Set<string>): Promise<ComponentModule | undefined> {
    const file = this.componentPath(alias)
    // The site's own component wins; an extension's renders in its own process.
    if (!file) return this.#extensionComponents?.module(alias)
    used?.add(file)
    // The path carries the generation, so one entry per view per generation and
    // a swap never answers from the generation before it.
    const cached = this.#modules.get(file)
    if (cached) return cached

    const module = (await import(pathToFileURL(file).href)) as ComponentModule
    if (typeof module.default !== 'function') {
      throw new Error(`Template '${alias}' does not export a default function.`)
    }
    this.#modules.set(file, module)
    return module
  }
}

const viewTranspiler = new Bun.Transpiler({ loader: 'tsx' })

/** A relative import's file in the views: as written, or with the extension it leaves off. */
function resolveView(path: string): string | undefined {
  for (const candidate of [
    path,
    ...['.tsx', '.ts', '.jsx', '.js'].map((extension) => `${path}${extension}`),
    ...['index.tsx', 'index.ts'].map((name) => join(path, name)),
  ])
    if (/\.[jt]sx?$/.test(candidate) && existsSync(candidate)) return candidate
  return undefined
}

/** What a template threw, for a person to act on (`Renderer.describeError`). */
export interface ErrorDescription {
  message: string
  /** The first line under `components/` it failed on: `components/card.tsx:12`. */
  location?: string
  stack: string
  /** The lines around that one (story 214). */
  code?: { line: number; lines: Array<{ number: number; text: string }> }
  /** The components rendering when it was thrown, outermost first (story 214). */
  components?: readonly string[]
}

const CODE_CONTEXT = 5

/** The lines either side of `line` in a file under `components/`, or nothing when it can't be read. */
function codeAround(
  componentsDir: string,
  file: string,
  line: number,
): Pick<ErrorDescription, 'code'> {
  const path = resolve(componentsDir, file)
  if (!path.startsWith(`${resolve(componentsDir)}${sep}`)) return {}
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  const all = text.split('\n')
  if (line < 1 || line > all.length) return {}
  const from = Math.max(1, line - CODE_CONTEXT)
  const to = Math.min(all.length, line + CODE_CONTEXT)
  const lines = []
  for (let number = from; number <= to; number++)
    lines.push({ number, text: all[number - 1] as string })
  return { code: { line, lines } }
}
