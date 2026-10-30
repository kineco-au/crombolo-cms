/**
 * The model a template sees.
 *
 * Deliberately close to Umbraco's `IPublishedContent`: small, with no `parent` or
 * `children` properties — navigation is a separate service, which is what keeps
 * the published cache cheap. `value()` carries the ergonomics: culture is
 * ambient, so `model.value('title')` returns the current request's culture.
 */

import type { FieldError, FormSubmissionState } from '@crombolo/core'
import type { RawHtml } from './html.ts'
import type { MediaWithCrops } from './media.ts'
import type { MenuItem } from './menus.ts'
import type { SeoSiteDefaults } from './seo.ts'
import { NAVI_HIDE_ALIAS } from './url-segment.ts'
import {
  convertValue,
  convertValueNow,
  htmlOf,
  picksOf,
  textOf,
  type ValueContext,
} from './values.ts'

export type FallbackStrategy = 'none' | 'defaultValue' | 'language' | 'ancestors'

export interface ValueOptions {
  culture?: string | null
  segment?: string | null
  fallback?: FallbackStrategy
  default?: unknown
}

/** The property aliases a page's interface names; any string for an untyped page. */
export type AliasOf<Properties> = keyof Properties & string

/** A property's type from the page's interface; `unknown` for an untyped page. */
export type ValueOf<Properties, Alias extends keyof Properties> = 0 extends 1 & Properties
  ? unknown
  : Properties[Alias]

export interface PublishedProperty {
  alias: string
  editorAlias: string
  culture: string | null
  segment: string | null
  value: unknown
  /** The data type's configuration, for converters that depend on it. */
  config?: Record<string, unknown>
}

export interface PublishedContentInit {
  key: string
  id: number
  name: string
  contentTypeAlias: string
  urlSegment: string
  url: string
  level: number
  path: string
  sortOrder: number
  createDate: Date
  updateDate: Date
  componentAlias: string | null
  cultures: string[]
  properties: PublishedProperty[]
  /** The culture in scope for this request; null for an invariant site. */
  variationCulture: string | null
  /** Fallback chain for `language` fallback, nearest first. */
  languageFallback?: string[]
}

/**
 * A published page. `Properties` is the page's interface from `crombolo generate`;
 * given one, `value()` and its siblings accept only that type's aliases and
 * `value()` returns the property's type. Without one, any alias is accepted and
 * `value()` returns `unknown`.
 *
 * The default is `any` rather than an index type so that a typed page fits
 * wherever a plain `PublishedContent` is accepted: `nav.children(model)`, a
 * component's own props.
 */
// biome-ignore lint/suspicious/noExplicitAny: the default that lets every typed page in; see above.
export class PublishedContent<Properties = any> {
  readonly key: string
  readonly id: number
  readonly name: string
  readonly contentType: { alias: string }
  readonly urlSegment: string
  readonly url: string
  readonly level: number
  readonly path: string
  readonly sortOrder: number
  readonly createDate: Date
  readonly updateDate: Date
  readonly componentAlias: string | null
  readonly cultures: string[]
  readonly properties: PublishedProperty[]
  #culture: string | null
  #fallbackChain: string[]
  #ancestors: PublishedContent[] = []
  #context: ValueContext<PublishedContent> | undefined

  constructor(init: PublishedContentInit) {
    this.key = init.key
    this.id = init.id
    this.name = init.name
    this.contentType = { alias: init.contentTypeAlias }
    this.urlSegment = init.urlSegment
    this.url = init.url
    this.level = init.level
    this.path = init.path
    this.sortOrder = init.sortOrder
    this.createDate = init.createDate
    this.updateDate = init.updateDate
    this.componentAlias = init.componentAlias
    this.cultures = init.cultures
    this.properties = init.properties
    this.#culture = init.variationCulture
    this.#fallbackChain = init.languageFallback ?? []
  }

  /** False when the page is marked `umbracoNaviHide`, so menus leave it out. */
  get isVisible(): boolean {
    const hidden = this.#read(NAVI_HIDE_ALIAS, {})
    return !(hidden === true || hidden === 1 || hidden === '1' || hidden === 'true')
  }

  /** The culture in scope: the request's for content that varies by culture, else null. */
  get culture(): string | null {
    return this.#culture
  }

  /** How pickers, links and blocks resolve what they point at; the cache supplies it. */
  withValueContext(context: ValueContext<PublishedContent> | undefined): this {
    // Its own update date, for what its values say about when they changed.
    this.#context = context && { ...context, updated: this.updateDate }
    return this
  }

  #convert = (property: PublishedProperty): unknown =>
    convertValue(
      property.editorAlias,
      property.value,
      this.#context as ValueContext,
      property.config,
    )

  #convertNow = (property: PublishedProperty): unknown =>
    convertValueNow(
      property.editorAlias,
      property.value,
      this.#context as ValueContext,
      property.config,
    )

  /**
   * A Media Picker's picks as a list, whether the picker allows one or many.
   * Media is looked up as it is read (story 197): `await model.media('hero')`.
   */
  async media(alias: AliasOf<Properties>, options: ValueOptions = {}): Promise<MediaWithCrops[]> {
    return picksOf(await this.#read(alias, options))
  }

  /** Ancestors, nearest first; used by the `ancestors` fallback strategy. */
  withAncestors(ancestors: PublishedContent[]): this {
    this.#ancestors = ancestors
    return this
  }

  getProperty(alias: AliasOf<Properties>): PublishedProperty | undefined {
    return this.properties.find((property) => property.alias === alias)
  }

  hasValue(alias: AliasOf<Properties>, options: ValueOptions = {}): boolean {
    const found = this.#find(alias, options)
    return found !== undefined && found.value !== null && found.value !== ''
  }

  /**
   * Resolves a property value: exact match first, then the fallback strategy,
   * then the raw value regardless of culture — the same order Umbraco uses.
   */
  value<Alias extends AliasOf<Properties>>(
    alias: Alias,
    options: ValueOptions = {},
  ): ValueOf<Properties, Alias> {
    return this.#read(alias, options) as ValueOf<Properties, Alias>
  }

  #read(alias: string, options: ValueOptions, now = false): unknown {
    const convert = now ? this.#convertNow : this.#convert
    const exact = this.#find(alias, options)
    if (exact && exact.value !== null && exact.value !== '') return convert(exact)

    switch (options.fallback) {
      case 'defaultValue':
        return options.default ?? null
      case 'language': {
        for (const culture of this.#fallbackChain) {
          const found = this.#find(alias, { ...options, culture })
          if (found && found.value !== null && found.value !== '') return convert(found)
        }
        break
      }
      case 'ancestors': {
        for (const ancestor of this.#ancestors) {
          const found = ancestor.#read(alias, { ...options, fallback: 'none' }, now)
          if (found !== null && found !== undefined && found !== '') return found
        }
        break
      }
      default:
        break
    }

    if (options.default !== undefined) return options.default
    return exact?.value ?? null
  }

  /**
   * `value()` coerced to a string, for direct use in markup. It never waits: a
   * rich text's links to media, which have to be looked up, are `#` here, so
   * rich text is written with `html()`.
   */
  text(alias: AliasOf<Properties>, options: ValueOptions = {}): string {
    return textOf(this.#read(alias, options, true))
  }

  /**
   * A rich-text value, marked so the renderer does not escape it. A promise when
   * it links to media, which JSX renders as it is: `{model.html('body')}`.
   */
  html(alias: AliasOf<Properties>, options: ValueOptions = {}): RawHtml | Promise<RawHtml> {
    return htmlOf(this.#read(alias, options))
  }

  #find(alias: string, options: ValueOptions): PublishedProperty | undefined {
    const culture = options.culture === undefined ? this.#culture : options.culture
    const segment = options.segment ?? null
    const matches = this.properties.filter((property) => property.alias === alias)
    return (
      matches.find(
        (property) =>
          (property.culture ?? null) === (culture ?? null) &&
          (property.segment ?? null) === segment,
      ) ??
      // An invariant value satisfies a culture-scoped read.
      matches.find((property) => property.culture === null && property.segment === null)
    )
  }
}

/**
 * The member signed in on this request. `roles` are member group **names**, the
 * same currency public-access rules deal in, so a template can ask
 * `member?.roles.includes('Subscribers')`.
 */
export interface RequestMember {
  key: string
  name: string
  username: string
  email: string
  roles: string[]
}

/** The query string, as Next.js hands it to a page: repeated names become arrays. */
export type SearchParams = Record<string, string | string[] | undefined>

/**
 * What a status page is told about the outcome it is answering (story 206):
 * the status, the words the code gave, any field errors, and for a server
 * error its reference, with the details only where they may be shown.
 */
export interface PageOutcome {
  status: number
  /** The helper's name, `notFound`; `serverError` for a 500. */
  name: string
  message?: string
  errors: readonly FieldError[]
  /** A 500's reference, which the log line carries too. */
  reference?: string
  /**
   * A 500's message, source and stack, when `errors.showDetails` allows; for a
   * template error also the code around the line and the component stack.
   */
  details?: {
    message: string
    location?: string
    stack?: string
    code?: { line: number; lines: ReadonlyArray<{ number: number; text: string }> }
    components?: readonly string[]
  }
}

/**
 * What a template receives. Name the page's interface from `crombolo generate`
 * to have its properties checked: `PageProps<HomePage>`.
 */
// biome-ignore lint/suspicious/noExplicitAny: an untyped page, as `PublishedContent` defaults to.
export interface PageProps<Properties = any> {
  model: PublishedContent<Properties>
  /** Navigation, kept out of the model exactly as Umbraco does. */
  nav: Navigation
  culture: string | null
  /** A dictionary item in the request's culture, then its fallback languages; '' when missing. */
  dictionary: (key: string) => string
  /**
   * A menu's items by the menu's alias, in the request's culture: `menu('header')`.
   * Read before the page renders, media included, so it stays synchronous.
   * Empty when there is no such menu (story 141; docs/rendering.md, "Menus").
   */
  menu: (alias: string) => MenuItem[]
  /** The signed-in member, or undefined for an anonymous visitor. */
  member: RequestMember | undefined
  /**
   * What just happened to a form submission on this page, when one did. Passed
   * to `<Form submission={…} />` so a refused submission comes back inside the
   * page's own layout rather than on a bare error page.
   */
  submission: FormSubmissionState | undefined
  /** The address requested, and the scheme and host it came in on. */
  request: { origin: string; url: string }
  /**
   * The query string, as a promise as in Next.js 15. Awaiting it makes the page
   * personal; empty on a page that exports `dynamic = 'force-static'`.
   */
  searchParams: Promise<SearchParams>
  /** On a status page, what it is answering; undefined on any other page. */
  outcome?: PageOutcome
  urls: {
    /** A page's address with scheme and host; undefined for one with no address here. */
    absolute(content: PublishedContent): string | undefined
    /** A page's address in each language it is published in. */
    alternates(content: PublishedContent): Array<{
      culture: string | null
      url: string
      isDefault: boolean
    }>
  }
  /** Site-wide search and sharing values, for `<SeoHead>`. */
  seo: SeoSiteDefaults
  /**
   * Aborts when the render runs out of time or the visitor disconnects. Pass it
   * to anything an async component waits on: `fetch(url, { signal })`.
   */
  signal: AbortSignal
}

export interface NavigationOptions {
  /** Leave out pages marked `umbracoNaviHide`. */
  visibleOnly?: boolean
}

export interface Navigation {
  parent(content: PublishedContent): PublishedContent | undefined
  children(content: PublishedContent, options?: NavigationOptions): PublishedContent[]
  ancestors(content: PublishedContent): PublishedContent[]
  root(options?: NavigationOptions): PublishedContent[]
  /**
   * Published content by key, in the request's culture.
   *
   * The only lookup that does not start from the page being rendered, which is
   * what a query rooted at a document somebody picked needs — the template
   * query builder writes `nav.byKey('…')` for exactly that.
   */
  byKey(key: string): PublishedContent | undefined
}
