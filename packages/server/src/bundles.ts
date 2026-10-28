/**
 * Server-side bundle extensions: a bundle that has to answer a request, not just
 * render a screen.
 *
 * `docs/bundles.md` argued that server-side extensions should not exist here,
 * and the objection was specific — loading third-party JS into a running node
 * has no isolation story, and a `role: web` node would never see a runtime
 * install. What answers it is wiring rather than sandboxing: **nothing in this
 * file is discovered**. A bundle installed from the marketplace writes
 * `package.json` and nothing more; its server half exists only because someone
 * imported the factory into `crombolo.config.ts` and deployed that, which is a
 * reviewable diff that reaches every node. The path from "someone clicked
 * install" to "third-party code is in the request path" is not merely guarded,
 * it is absent.
 *
 * What a wired bundle then gets is deliberately small:
 *
 * - Routes mount under `<backoffice>/crombolo/api/bundle/<id>/`. The id and every
 *   route path are validated, so a bundle can neither shadow a core route nor
 *   reach another bundle's.
 * - The host authenticates and checks the declared section **before** dispatch. A
 *   back-office handler never sees an anonymous request, and a bundle cannot
 *   widen its own authorisation.
 * - A route that declares a `member` or `public` audience (story 186) answers on
 *   the site instead, under `/crombolo/bundle/<id>/`, and nowhere else. The host
 *   identifies the member, checks their groups, the anti-forgery token and the
 *   rate limit before dispatch.
 * - It receives only the capabilities it declared, frozen. No `Db`, no config, no
 *   filesystem. A capability is a narrow interface this file owns and implements,
 *   so the blast radius is what core chose to expose rather than what the bundle
 *   can reach.
 * - A handler that throws becomes a 500 and a log line naming the bundle, never a
 *   broken request path.
 *
 * - Every wired bundle belongs to an npm package the site declares, whose
 *   `crombolo` manifest names the same id and declares a server half. Its name,
 *   version and peer range come from there, and a peer range that excludes this
 *   release refuses the boot.
 *
 * - A bundle that declares `tables` owns them: its own ledgered chain, written
 *   with the declarative builder in `@crombolo/data`, and a `tables`
 *   capability confined to them (`docs/bundles.md`, Part 4).
 *
 * Deliberately not offered: raw SQL, a `Db`, and anything that writes the
 * site's files.
 */

import { type CorsPolicy, isPreflight, preflightResponse, withCors } from '@crombolo/api-delivery'
import { hasCultureAccess, hasSection, type Principal } from '@crombolo/api-management'
import { BUNDLE_ID, type BundlePackage, peerRangeProblem } from '@crombolo/backoffice-host'
import {
  type AppAlias,
  type ExtensionSectionAlias,
  isExtensionSectionAlias,
  MEMBER_FILE_TYPES,
  SECTION_ALIASES,
} from '@crombolo/core'
import {
  type BundleTables,
  type BundleTablesCapability,
  bundleTablesCompatibility,
  compileBundleTables,
  type Db,
  type RedirectMatchKind,
  RedirectRepository,
  type RedirectRow,
  type RedirectTargetKind,
} from '@crombolo/data'
import {
  ANTIFORGERY_HEADER,
  BUNDLE_SITE_PATH,
  normaliseRedirectPath,
  type PublishedCache,
} from '@crombolo/render'
import type { BundleMedia, BundleMediaDeclaration } from './bundle-media.ts'
import type { BundleForms } from './form-types.ts'
import type { BundleIdentityProviders } from './identity-provider-overrides.ts'
import { RateLimiter } from './rate-limit.ts'
import type { BundleEvents } from './webhooks.ts'

/** The segment every bundle's routes hang below, inside the plugin API. */
export const BUNDLE_API_SEGMENT = 'bundle'

/**
 * A route path below the bundle's namespace. Literal segments, optionally one
 * `:name` parameter each, and no leading or trailing slash — so a path cannot
 * traverse, and `''` means the namespace root.
 */
const ROUTE_PATH =
  /^(?:[a-z0-9][a-z0-9-]*|:[a-z][a-z0-9]*)(?:\/(?:[a-z0-9][a-z0-9-]*|:[a-z][a-z0-9]*))*$/

export type BundleMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** What the host writes to the site's log on the bundle's behalf. */
export interface BundleLog {
  info(message: string, properties?: Record<string, unknown>): void
  warn(message: string, properties?: Record<string, unknown>): void
  error(message: string, properties?: Record<string, unknown>): void
}

/** A redirect rule as the capability reports it. */
export interface BundleRedirectRule extends RedirectRow {
  /** Whether this bundle may change or delete it: only a `manual` rule. */
  editable: boolean
}

/** A rule to store. `source` is not a field: the capability sets it to `manual`. */
export interface BundleRedirectInput {
  matchKind: RedirectMatchKind
  pattern: string
  rootKey?: string | null
  culture?: string | null
  targetKind: RedirectTargetKind
  target: string
  statusCode?: number
  sortOrder?: number
}

export type BundleRedirectSaved =
  | { ok: true; rule: BundleRedirectRule }
  | { ok: false; message: string; reason?: 'notFound' | 'notEditable' }

/**
 * Redirect rules an administrator manages.
 *
 * `list` reports every rule in force, because a screen that hid the configured
 * and tracked ones would be lying about what the site does. Writing is confined
 * to `manual`: the capability sets the source itself and refuses a key belonging
 * to any other, so a bundle cannot forge a configured rule, delete one the
 * config file owns, or interfere with the URL tracker.
 */
export interface BundleRedirects {
  list(options?: { filter?: string; skip?: number; take?: number }): Promise<{
    total: number
    items: BundleRedirectRule[]
  }>
  byKey(key: string): Promise<BundleRedirectRule | undefined>
  save(input: BundleRedirectInput): Promise<BundleRedirectSaved>
  /**
   * Changes an existing rule, pattern included. A rule is identified by what it
   * matches, so editing the pattern is a different row — the host does the
   * delete and the insert rather than leaving a bundle to discover that and
   * leave the original behind.
   */
  replace(key: string, input: BundleRedirectInput): Promise<BundleRedirectSaved>
  remove(key: string): Promise<'deleted' | 'notFound' | 'notEditable'>
}

/** Reading where a document lives now, for a screen that shows a rule's target. */
export interface BundleDocuments {
  url(key: string, culture?: string | null): Promise<string | undefined>
}

/** Everything core is willing to hand a bundle. A capability is a key of this. */
export interface BundleHost {
  redirects: BundleRedirects
  documents: BundleDocuments
  log: BundleLog
  /** The identity providers the config declares, and an administrator's overrides of their settings (story 033). */
  identityProviders: BundleIdentityProviders
  /** The bundle's own tables, and only for a bundle that declares some. */
  tables: BundleTablesCapability
  /**
   * Media items in the folders the bundle declares, as the member a route was
   * given or the back-office user; refused on a public route (story 198).
   */
  media: BundleMedia
}

export type BundleCapability = keyof BundleHost

/**
 * The section a bundle gates its routes on: a core section by its application
 * alias, or a section the bundle's own manifests register by its manifest alias.
 * An extension's section needs nothing from the server beyond this — the
 * backoffice shows it to whoever's group was granted it, and the grant is stored
 * as the alias itself.
 */
export type BundleSection = AppAlias | ExtensionSectionAlias

/**
 * Re-exported so a bundle needs one dependency rather than three. `principal`
 * arrives on every `BundleRequest`, and a bundle that lifts a check out into a
 * helper has to be able to name its type; `BundleSection` is what `section` takes.
 */
export type { AppAlias, ExtensionSectionAlias, Principal }

/**
 * The two checks a bundle is likely to want beyond the section the host has
 * already enforced. `hasSection` normalises the alias, which matters because
 * `allowedSections` arrives either bare or as a manifest alias depending on where
 * it was read — comparing the strings by hand is the mistake this avoids.
 *
 * Anything finer — a permission verb, a start node, a per-node check — is read
 * off `principal` directly: `isAdmin`, `permissions`, `groupKeys`, `groups`,
 * `startNodes`, `languages`.
 */
export { hasCultureAccess, hasSection }

/** Every capability name, for validating what a bundle asked for. */
export const BUNDLE_CAPABILITIES: readonly BundleCapability[] = [
  'redirects',
  'documents',
  'log',
  'tables',
  'identityProviders',
  'media',
]

/** What a handler is handed: the declared capabilities, with `tables` typed from the declaration. */
export type HostFor<C extends BundleCapability, T extends BundleTables> = Pick<
  BundleHost,
  Exclude<C, 'tables'>
> &
  ('tables' extends C
    ? { tables: T extends BundleTables<infer S> ? BundleTablesCapability<S> : never }
    : unknown)

/** A signed-in member as a member route is given them: nothing of the back office. */
export interface BundleMember {
  readonly key: string
  readonly name: string
  readonly username: string
  readonly email: string
  /** Member group names. */
  readonly groups: readonly string[]
}

/**
 * Who may call a route. `backoffice`, the default, mounts it in the back office
 * behind the bundle's section; the others mount it on the site, for any
 * signed-in member, for members of the named groups, or for anyone.
 */
export type BundleAudience =
  | 'backoffice'
  | 'member'
  | { member: { groups: readonly string[] } }
  | 'public'

/**
 * At most `max` requests every `perSeconds`, counted by the member's key or by
 * the caller's address, on each server separately.
 */
export interface BundleRateLimit {
  max: number
  perSeconds: number
  by: 'member' | 'caller'
}

/**
 * Who a request is from, as the host resolved it before dispatch: the route's
 * audience decides which. A public route's caller is always `public`, even
 * when a member happens to be signed in. Frozen.
 */
export type BundleCaller =
  | { readonly kind: 'backoffice'; readonly principal: Principal }
  | { readonly kind: 'member'; readonly member: BundleMember; readonly via: 'cookie' | 'token' }
  | { readonly kind: 'public' }

interface BundleRequestBase<C extends BundleCapability, T extends BundleTables> {
  request: Request
  url: URL
  /** The `:name` segments of the matched route. */
  params: Record<string, string>
  /** Only what the bundle declared, frozen. */
  host: HostFor<C, T>
  /** Who is asking, which is what a capability acting for the caller reads. */
  caller: BundleCaller
}

/** What a back-office route's handler is given. */
export interface BundleRequest<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> extends BundleRequestBase<C, T> {
  /** Already authenticated, and already holding the bundle's declared section. */
  principal: Principal
  member?: undefined
}

/** What a member route's handler is given. */
export interface BundleMemberRequest<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> extends BundleRequestBase<C, T> {
  /** Signed in, approved, not locked out, and in the route's groups. Frozen. */
  member: BundleMember
  principal?: undefined
}

/** What a public route's handler is given: nobody. */
export interface BundlePublicRequest<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> extends BundleRequestBase<C, T> {
  principal?: undefined
  member?: undefined
}

interface BundleRouteBase {
  method: BundleMethod
  /** Below the bundle's namespace; `''` is the namespace root. */
  path: string
}

/** A route in the back office, behind the bundle's section: every route unless it says otherwise. */
export interface BackofficeBundleRoute<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> extends BundleRouteBase {
  audience?: 'backoffice'
  rateLimit?: undefined
  handler(context: BundleRequest<C, T>): Response | Promise<Response>
}

/** A route on the site for signed-in members, under `/crombolo/bundle/<id>/`. */
export interface MemberBundleRoute<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> extends BundleRouteBase {
  audience: 'member' | { member: { groups: readonly string[] } }
  rateLimit?: BundleRateLimit
  handler(context: BundleMemberRequest<C, T>): Response | Promise<Response>
}

/** A route on the site for anyone, under `/crombolo/bundle/<id>/`. */
export interface PublicBundleRoute<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> extends BundleRouteBase {
  audience: 'public'
  rateLimit?: BundleRateLimit
  handler(context: BundlePublicRequest<C, T>): Response | Promise<Response>
}

export type ServerBundleRoute<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> = BackofficeBundleRoute<C, T> | MemberBundleRoute<C, T> | PublicBundleRoute<C, T>

/** A route's audience as the host reads it: `backoffice` when none was declared. */
export function routeAudience(route: { audience?: BundleAudience }): BundleAudience {
  return route.audience ?? 'backoffice'
}

const onSite = (route: { audience?: BundleAudience }) => routeAudience(route) !== 'backoffice'

export interface ServerBundle<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> {
  /**
   * URL segment and log name: the `crombolo.id` of the package that exports
   * this bundle, which is where its name and version are read from.
   */
  id: string
  /**
   * The section a caller must have access to. Every back-office route is gated
   * on it; a route reaches anyone else only by declaring a site `audience`.
   */
  section: BundleSection
  capabilities: readonly C[]
  routes: readonly ServerBundleRoute<C, T>[]
  /** Tables the bundle owns, from `defineBundleTables`, under its own id. */
  tables?: T
  /**
   * Form field and workflow types it adds. Unlike its routes and tables these
   * are honoured on every node, because forms render and submit on `web` nodes.
   */
  forms?: BundleForms
  /** The media folders it uses, by path, and what it accepts: needed for the `media` capability. */
  media?: BundleMediaDeclaration
  /**
   * Handlers for webhook events, by alias. Each event reaches each handler
   * through the webhook delivery queue: once per cluster, after the change,
   * retried on failure, and in the delivery log (docs/webhooks.md).
   */
  events?: BundleEvents
}

/** A bundle as mounted, with the prefix its routes answer below. */
export interface MountedBundle {
  id: string
  /** From its package's manifest. */
  name: string
  package: { name: string; version: string; peerRange: string }
  section: BundleSection
  capabilities: readonly BundleCapability[]
  /** `<backoffice>/crombolo/api/bundle/<id>`. */
  prefix: string
  /** `/crombolo/bundle/<id>`, where its member and public routes answer. */
  sitePrefix: string
  routes: readonly { method: BundleMethod; path: string; audience: BundleAudience }[]
}

/**
 * Every reason this set of bundles cannot be mounted. Returned rather than
 * thrown so the boot can report all of them at once; `createServerBundles`
 * turns a non-empty list into a failed boot, because a bundle that is half
 * mounted is worse than one that is absent.
 *
 * `packages` are the bundles the site declares as dependencies. A wired bundle
 * must be one of them, so its version and peer range are always known.
 */
export function validateServerBundles(
  bundles: readonly ServerBundle[],
  packages: readonly BundlePackage[],
  coreVersion: string,
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const bundle of bundles) {
    const label = bundle.id || '<unnamed>'
    if (!BUNDLE_ID.test(bundle.id))
      problems.push(
        `Bundle "${label}" has the id "${bundle.id}", which is not 2–39 characters of lowercase letters, digits and hyphens starting with a letter.`,
      )
    else if (seen.has(bundle.id)) problems.push(`Two bundles claim the id "${bundle.id}".`)
    else {
      seen.add(bundle.id)
      const owner = packages.find((pkg) => pkg.id === bundle.id)
      if (!owner)
        problems.push(
          `Bundle "${label}" is wired in crombolo.config.ts, but no package the site depends on declares the bundle id "${bundle.id}". Add the package to package.json.`,
        )
      else if (!owner.carries.server)
        problems.push(
          `Bundle "${label}" is wired in crombolo.config.ts, but ${owner.packageName} declares no "server" in its crombolo manifest.`,
        )
      else {
        const peer = peerRangeProblem(owner, coreVersion)
        if (peer) problems.push(`Bundle "${label}" cannot run here: ${peer}.`)
      }
    }
    if (!(bundle.section in SECTION_ALIASES) && !isExtensionSectionAlias(bundle.section))
      problems.push(
        `Bundle "${label}" is gated on the section "${bundle.section}", which is neither a core section nor a manifest alias of the form Vendor.Section.Name.`,
      )
    for (const capability of bundle.capabilities)
      if (!BUNDLE_CAPABILITIES.includes(capability))
        problems.push(
          `Bundle "${label}" asked for the capability "${capability}", which no host offers.`,
        )
    if (bundle.capabilities.includes('tables') && !bundle.tables)
      problems.push(
        `Bundle "${label}" asked for the capability "tables", but declares no tables of its own.`,
      )
    if (bundle.tables) {
      if (bundle.tables.id !== bundle.id)
        problems.push(
          `Bundle "${label}" declares its tables under the id "${bundle.tables.id}"; a bundle's tables are under its own id.`,
        )
      const owner = packages.find((pkg) => pkg.id === bundle.id)
      for (const problem of compileBundleTables(bundle.tables, owner?.version).problems)
        problems.push(`Bundle "${label}" tables: ${problem}.`)
      // Read by an operator's tooling before anything is installed, so it must
      // say what the plan does — derived, not asserted, as core's is.
      if (owner) {
        const derived = bundleTablesCompatibility(bundle.tables, owner.version)
        if (owner.field.migrations !== derived)
          problems.push(
            `Bundle "${label}"'s package.json declares "crombolo.migrations": ${JSON.stringify(owner.field.migrations ?? null)}, but its tables make ${owner.version} "${derived}".`,
          )
      }
    }
    for (const problem of mediaProblems(bundle))
      problems.push(`Bundle "${label}" media: ${problem}.`)
    const routes = new Set<string>()
    for (const route of bundle.routes) {
      if (route.path !== '' && !ROUTE_PATH.test(route.path))
        problems.push(
          `Bundle "${label}" declares the route path "${route.path}", which is not a plain path of segments.`,
        )
      const signature = `${route.method} ${route.path}`
      const where = onSite(route) ? 'site' : 'backoffice'
      if (routes.has(`${where} ${signature}`))
        problems.push(`Bundle "${label}" declares "${signature}" twice.`)
      routes.add(`${where} ${signature}`)
      for (const problem of routeProblems(route))
        problems.push(`Bundle "${label}" route "${signature}": ${problem}.`)
    }
  }
  return problems
}

const isPositiveInteger = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

/** What is wrong with a bundle's media declaration, read as untyped config. */
function mediaProblems(bundle: ServerBundle): string[] {
  const asks = bundle.capabilities.includes('media')
  const media = bundle.media as unknown as Record<string, unknown> | undefined
  if (!asks)
    return media === undefined ? [] : ['it declares media folders but not the "media" capability']
  if (typeof media !== 'object' || media === null)
    return [
      'the "media" capability needs { folders: ["/Folder/Path"], maxBytes } to say where it writes',
    ]
  const problems: string[] = []
  const folders = media.folders
  if (!Array.isArray(folders) || folders.length === 0)
    problems.push('it names no folders; give each by its path, such as "/Observations/Photos"')
  else
    for (const folder of folders)
      if (
        typeof folder !== 'string' ||
        !folder.startsWith('/') ||
        folder
          .split('/')
          .slice(1)
          .some((segment) => segment.trim() === '')
      )
        problems.push(
          `the folder ${JSON.stringify(folder)} is not a path such as "/Observations/Photos"`,
        )
  if (!isPositiveInteger(media.maxBytes))
    problems.push('maxBytes is a whole number of bytes above 0')
  if (media.types !== undefined) {
    const known = MEMBER_FILE_TYPES.map((type) => type.id)
    if (!Array.isArray(media.types)) problems.push(`types is a list of ${known.join(', ')}`)
    else
      for (const type of media.types)
        if (!known.includes(type as string))
          problems.push(`the type ${JSON.stringify(type)} is not one of ${known.join(', ')}`)
  }
  return problems
}

/** What is wrong with a route's audience and rate limit, read as untyped config. */
function routeProblems(route: ServerBundleRoute): string[] {
  const problems: string[] = []
  const audience = route.audience as unknown
  if (typeof audience === 'object' && audience !== null) {
    const groups = (audience as { member?: { groups?: unknown } }).member?.groups
    if (
      Object.keys(audience).join() !== 'member' ||
      !Array.isArray(groups) ||
      groups.length === 0 ||
      groups.some((group) => typeof group !== 'string' || group.trim() === '')
    )
      problems.push('a member audience names its groups as { member: { groups: ["Name", …] } }')
  } else if (
    audience !== undefined &&
    audience !== 'backoffice' &&
    audience !== 'member' &&
    audience !== 'public'
  )
    problems.push(
      `the audience "${String(audience)}" is not one of backoffice, member, { member: { groups } } or public`,
    )

  const limit = route.rateLimit as unknown as Record<string, unknown> | undefined
  if (limit === undefined) return problems
  if (!onSite(route)) {
    problems.push('a rate limit applies only to member and public routes')
    return problems
  }
  if (typeof limit !== 'object' || limit === null)
    problems.push('a rate limit is { max, perSeconds, by }')
  else {
    if (!isPositiveInteger(limit.max)) problems.push("a rate limit's max is a whole number above 0")
    if (!isPositiveInteger(limit.perSeconds))
      problems.push("a rate limit's perSeconds is a whole number above 0")
    if (limit.by !== 'member' && limit.by !== 'caller')
      problems.push('a rate limit counts by "member" or by "caller"')
    else if (limit.by === 'member' && audience === 'public')
      problems.push('a public route has no member to count by; count by "caller"')
  }
  return problems
}

/** Member group names a site route requires, for checking at boot that they exist. */
export function bundleRouteGroups(bundles: readonly ServerBundle[]): string[] {
  const groups = new Set<string>()
  for (const bundle of bundles)
    for (const route of bundle.routes) {
      const audience = routeAudience(route)
      if (typeof audience === 'object')
        for (const group of audience.member.groups) groups.add(group)
    }
  return [...groups]
}

/** `rules/:key` against `rules/abc` — the params, or undefined when it does not match. */
function matchRoute(path: string, requested: string): Record<string, string> | undefined {
  if (path === '' && requested === '') return {}
  const declared = path.split('/')
  const actual = requested.split('/')
  if (declared.length !== actual.length) return undefined
  const params: Record<string, string> = {}
  for (const [index, segment] of declared.entries()) {
    const value = actual[index] as string
    if (segment.startsWith(':')) {
      if (value === '') return undefined
      params[segment.slice(1)] = decodeURIComponent(value)
    } else if (segment !== value) return undefined
  }
  return params
}

const STATUS_CODES = new Set([301, 302, 307, 308])
const MATCH_KINDS = new Set<RedirectMatchKind>(['exact', 'prefix', 'regex'])
const TARGET_KINDS = new Set<RedirectTargetKind>(['document', 'path', 'url'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ABSOLUTE_URL = /^https?:\/\/\S+$/i

/**
 * Checks a rule before it is stored, so one bad row cannot sit in the table
 * breaking route resolution for every request. A regex is compiled here rather
 * than at match time for exactly that reason: the matcher runs on the request
 * path, and a pattern that throws there would 500 the site rather than the
 * screen that saved it.
 */
export function validateRedirectInput(
  input: BundleRedirectInput,
): { ok: true; value: Required<BundleRedirectInput> } | { ok: false; message: string } {
  if (!MATCH_KINDS.has(input.matchKind))
    return { ok: false, message: 'Choose how the URL is matched.' }
  if (!TARGET_KINDS.has(input.targetKind))
    return { ok: false, message: 'Choose what the redirect points at.' }
  const statusCode = input.statusCode ?? 301
  if (!STATUS_CODES.has(statusCode))
    return { ok: false, message: 'The status code must be 301, 302, 307 or 308.' }

  const pattern = input.pattern?.trim() ?? ''
  if (pattern === '') return { ok: false, message: 'Enter the URL to redirect from.' }
  if (input.matchKind === 'regex') {
    try {
      new RegExp(pattern, 'i')
    } catch {
      return { ok: false, message: 'That is not a valid regular expression.' }
    }
  }

  const target = input.target?.trim() ?? ''
  if (target === '') return { ok: false, message: 'Enter where the redirect should go.' }
  if (input.targetKind === 'document' && !UUID.test(target))
    return { ok: false, message: 'Pick the page to redirect to.' }
  if (input.targetKind === 'url' && !ABSOLUTE_URL.test(target))
    return { ok: false, message: 'An external target must be a full http:// or https:// URL.' }

  const normalised = input.matchKind === 'regex' ? pattern : normaliseRedirectPath(pattern)
  const rootKey = input.rootKey?.trim() ? input.rootKey.trim().toLowerCase() : null
  if (rootKey !== null && !UUID.test(rootKey))
    return { ok: false, message: 'The site a rule is scoped to must be a document key.' }

  // A rule pointing a route at itself would loop the browser; the exact case is
  // cheap to catch and is what a typo produces.
  if (input.targetKind === 'path' && normaliseRedirectPath(target) === normalised)
    return { ok: false, message: 'That rule points the URL at itself.' }

  return {
    ok: true,
    value: {
      matchKind: input.matchKind,
      pattern: normalised,
      rootKey,
      culture: input.culture?.trim() ? input.culture.trim().toLowerCase() : null,
      targetKind: input.targetKind,
      target: input.targetKind === 'document' ? target.toLowerCase() : target,
      statusCode,
      sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
    },
  }
}

/** The manual-redirect capability over the repository core already owns. */
export function createBundleRedirects(options: {
  db: Db
  cache?: PublishedCache
}): BundleRedirects {
  const redirects = new RedirectRepository(options.db)
  const report = (row: RedirectRow): BundleRedirectRule => ({
    ...row,
    editable: row.source === 'manual',
  })
  // Rules are part of the published cache's snapshot, so a write that does not
  // drop it does not take effect until something else does. The capability does
  // this rather than the bundle, which cannot be relied on to remember.
  const invalidate = () => options.cache?.invalidate()

  return {
    async list(paging = {}) {
      const result = await redirects.list(paging)
      return { total: result.total, items: result.items.map(report) }
    },
    async byKey(key) {
      const found = await redirects.byKey(key)
      return found ? report(found) : undefined
    },
    async save(input) {
      const checked = validateRedirectInput(input)
      if (!checked.ok) return { ok: false, message: checked.message }
      const stored = await redirects.save({ ...checked.value, source: 'manual' })
      invalidate()
      return { ok: true, rule: report(stored) }
    },
    async replace(key, input) {
      // Validated before anything is deleted, so the ordinary failure — a
      // malformed rule — cannot cost the rule being edited.
      const checked = validateRedirectInput(input)
      if (!checked.ok) return { ok: false, message: checked.message }
      const found = await redirects.byKey(key)
      if (!found)
        return { ok: false, message: 'That redirect no longer exists.', reason: 'notFound' }
      if (found.source !== 'manual')
        return {
          ok: false,
          message:
            found.source === 'config'
              ? "That redirect is declared in the site's configuration, so the file owns it."
              : 'That redirect was recorded by a rename, so it cannot be edited here.',
          reason: 'notEditable',
        }
      await redirects.delete(key)
      const stored = await redirects.save({ ...checked.value, source: 'manual' })
      invalidate()
      return { ok: true, rule: report(stored) }
    },
    async remove(key) {
      const found = await redirects.byKey(key)
      if (!found) return 'notFound'
      // The file owns a configured rule and the tracker owns a tracked one; a
      // bundle deleting either would be undone at the next boot or publish
      // anyway, so it is refused rather than silently reverted.
      if (found.source !== 'manual') return 'notEditable'
      await redirects.delete(key)
      invalidate()
      return 'deleted'
    },
  }
}

/**
 * A capability built for each request from its caller, so it can act as them:
 * story 198's media, for one, which writes as the member a route was given and
 * refuses a public caller. It is told the bundle too, for what it declared.
 */
export type CallerCapabilities = {
  [K in Exclude<BundleCapability, 'tables'>]?: (
    caller: BundleCaller,
    bundle: ServerBundle,
  ) => BundleHost[K]
}

/** How the site dispatcher identifies a member and the caller (story 186). */
export interface BundleSiteOptions {
  /**
   * The member the site's cookie signs in, and a check that an anti-forgery
   * token belongs to that session.
   */
  session(
    request: Request,
  ): Promise<{ member: BundleMember; verify(token: string | null): Promise<boolean> } | undefined>
  /** The member a Delivery API member token names, when they may sign in now. */
  memberByToken?(token: string): Promise<BundleMember | undefined>
  /** The Delivery API's allowed origins, which get CORS headers. */
  cors?: CorsPolicy
  /** The real client address, for a limit counted by caller. */
  callerAddress(request: Request): string
  now?(): number
}

export interface ServerBundlesOptions {
  bundles: readonly ServerBundle[]
  /** The bundle packages the site depends on, from discovery. */
  packages: readonly BundlePackage[]
  /** The running release, which every bundle's peer range must admit. */
  coreVersion: string
  /** `<backoffice>/crombolo/api`, from `createBackOfficePaths`. */
  pluginApiPath: string
  host: Omit<BundleHost, 'tables' | 'media'> & { media?: BundleMedia }
  /** Capabilities built per request from the caller, in place of the ones in `host`. */
  callerHost?: CallerCapabilities
  /** Named per bundle, so a log line says which one wrote it. */
  log(bundleId: string): BundleLog
  /** A bundle's own tables, resolved against its schema alone; absent where none are offered. */
  tables?(bundle: ServerBundle): BundleTablesCapability | undefined
  /** Without it no member can be identified, so a member route answers 401. */
  site?: BundleSiteOptions
}

export interface ServerBundles {
  readonly mounted: readonly MountedBundle[]
  /** The prefix every bundle route sits below, including the trailing slash. */
  readonly basePath: string
  /** The prefix member and public routes sit below, including the trailing slash. */
  readonly sitePath: string
  /**
   * Answers a request in the bundle namespace. `undefined` means the path belongs
   * to no bundle, so the caller falls through to its own 404.
   */
  handle(request: Request, url: URL, principal: Principal): Promise<Response | undefined>
  /**
   * Answers a member or public route below `/crombolo/bundle/`; `undefined`
   * only for a path outside it.
   */
  site(request: Request, url: URL): Promise<Response | undefined>
}

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const SITE_METHODS = 'GET, POST, PUT, DELETE'
const BEARER = /^Bearer\s+(\S+)\s*$/i

const text = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  })

const freezeMember = (member: BundleMember): BundleMember =>
  Object.freeze({
    key: member.key,
    name: member.name,
    username: member.username,
    email: member.email,
    groups: Object.freeze([...member.groups]),
  })

/** Whether a member is in one of the groups, matched as `memberMay` matches them: in any case. */
const inGroups = (member: BundleMember, groups: readonly string[]) => {
  const held = new Set(member.groups.map((group) => group.toLowerCase()))
  return groups.some((group) => held.has(group.toLowerCase()))
}

/**
 * Mounts the site's bundles, or fails the boot saying why.
 *
 * Validation is not advisory: a bundle with a bad id would otherwise answer on a
 * path nobody intended, and one asking for a capability the host does not have
 * would fail on its first request rather than at boot.
 */
export function createServerBundles(options: ServerBundlesOptions): ServerBundles {
  const problems = validateServerBundles(options.bundles, options.packages, options.coreVersion)
  if (problems.length > 0)
    throw new Error(`The configured bundles cannot be mounted:\n- ${problems.join('\n- ')}`)

  const basePath = `${options.pluginApiPath}/${BUNDLE_API_SEGMENT}/`
  const sitePath = `${BUNDLE_SITE_PATH}/`
  const byId = new Map(options.bundles.map((bundle) => [bundle.id, bundle]))
  const logs = new Map(options.bundles.map((bundle) => [bundle.id, options.log(bundle.id)]))

  const owners = new Map(options.packages.map((pkg) => [pkg.id, pkg]))
  const mounted: MountedBundle[] = options.bundles.map((bundle) => {
    const owner = owners.get(bundle.id) as BundlePackage
    return {
      id: bundle.id,
      name: owner.name,
      package: { name: owner.packageName, version: owner.version, peerRange: owner.peerRange },
      section: bundle.section,
      capabilities: bundle.capabilities,
      prefix: `${basePath}${bundle.id}`,
      sitePrefix: `${sitePath}${bundle.id}`,
      routes: bundle.routes.map((route) => ({
        method: route.method,
        path: route.path,
        audience: routeAudience(route),
      })),
    }
  })
  const names = new Map(mounted.map((bundle) => [bundle.id, bundle.name]))

  // Built once per bundle, each over that bundle's schema alone.
  const tables = new Map(
    options.bundles
      .filter((bundle) => bundle.capabilities.includes('tables'))
      .map((bundle) => [bundle.id, options.tables?.(bundle)]),
  )
  /** Only the declared capabilities, frozen, so a handler cannot reach further. */
  const contextFor = (
    bundle: ServerBundle,
    caller: BundleCaller,
  ): Pick<BundleHost, BundleCapability> => {
    const host: Record<string, unknown> = {}
    for (const capability of bundle.capabilities) {
      const forCaller = capability === 'tables' ? undefined : options.callerHost?.[capability]
      host[capability] = forCaller
        ? forCaller(caller, bundle)
        : capability === 'log'
          ? (logs.get(bundle.id) as BundleLog)
          : capability === 'tables'
            ? tables.get(bundle.id)
            : options.host[capability]
    }
    return Object.freeze(host) as Pick<BundleHost, BundleCapability>
  }

  /** The bundle and the path below it, for a request under `prefix`. */
  const locate = (pathname: string, prefix: string) => {
    const rest = pathname.slice(prefix.length)
    const slash = rest.indexOf('/')
    const bundle = byId.get(slash === -1 ? rest : rest.slice(0, slash))
    const requested = (slash === -1 ? '' : rest.slice(slash + 1)).replace(/\/$/, '')
    return { bundle, requested }
  }

  /** The route for this path and method among `routes`, or the 404 or 405 to answer. */
  const find = (
    routes: readonly ServerBundleRoute[],
    requested: string,
    method: string,
  ): { route: ServerBundleRoute; params: Record<string, string> } | { refused: Response } => {
    let pathExists = false
    for (const route of routes) {
      const params = matchRoute(route.path, requested)
      if (!params) continue
      pathExists = true
      if (route.method === method) return { route, params }
    }
    return {
      refused: pathExists
        ? text('Method Not Allowed', 405, { allow: SITE_METHODS })
        : text('Not Found', 404),
    }
  }

  /** A bundle's mistake is its own 500, named, rather than an unhandled rejection in the request path. */
  const dispatch = async (
    bundle: ServerBundle,
    route: ServerBundleRoute,
    context: Omit<BundleRequestBase<BundleCapability, BundleTables>, 'host'> & {
      principal?: Principal
      member?: BundleMember
    },
  ): Promise<Response> => {
    try {
      const handler = route.handler as (context: unknown) => Response | Promise<Response>
      return await handler({ ...context, host: contextFor(bundle, context.caller) })
    } catch (error) {
      logs.get(bundle.id)?.error('The bundle {bundle} failed to answer {method} {path}', {
        bundle: names.get(bundle.id),
        method: context.request.method.toUpperCase(),
        path: context.url.pathname,
        error,
      })
      return new Response('Internal Server Error', { status: 500 })
    }
  }

  const limiters = new Map<ServerBundleRoute, RateLimiter>()
  for (const bundle of options.bundles)
    for (const route of bundle.routes)
      if (route.rateLimit)
        limiters.set(
          route,
          new RateLimiter({
            max: route.rateLimit.max,
            windowMs: route.rateLimit.perSeconds * 1000,
            now: options.site?.now,
          }),
        )
  const tooMany = (wait: number) =>
    text('Too many requests. Try again in a moment.', 429, { 'retry-after': String(wait) })

  /** Who is calling a member route, or the refusal to answer instead. */
  const identify = async (
    request: Request,
    route: ServerBundleRoute,
  ): Promise<{ caller: BundleCaller & { kind: 'member' } } | { refused: Response }> => {
    const bearer = BEARER.exec(request.headers.get('authorization') ?? '')?.[1]
    let caller: BundleCaller & { kind: 'member' }
    if (bearer) {
      // A token's scopes never widen the route: it says only who the member is.
      const member = await options.site?.memberByToken?.(bearer)
      if (!member)
        return {
          refused: text('Sign in to continue.', 401, {
            'www-authenticate': 'Bearer error="invalid_token"',
          }),
        }
      caller = Object.freeze({ kind: 'member', member: freezeMember(member), via: 'token' })
    } else {
      const session = await options.site?.session(request)
      if (!session) return { refused: text('Sign in to continue.', 401) }
      // A cookie is sent whichever site made the request; only a page of this
      // one can read the token to send with it.
      if (
        !SAFE_METHODS.has(request.method.toUpperCase()) &&
        !(await session.verify(request.headers.get(ANTIFORGERY_HEADER)))
      )
        return {
          refused: text(
            `This request was refused because it did not come from a page of this site. Add <AntiforgeryMeta /> to the page's layout, and send the request with crombolo.fetch from /crombolo/bundle.js, which adds the ${ANTIFORGERY_HEADER} header.`,
            403,
          ),
        }
      caller = Object.freeze({
        kind: 'member',
        member: freezeMember(session.member),
        via: 'cookie',
      })
    }
    const audience = routeAudience(route)
    if (typeof audience === 'object' && !inGroups(caller.member, audience.member.groups))
      return { refused: text('Your account does not have access to this.', 403) }
    return { caller }
  }

  const answerSite = async (request: Request, url: URL): Promise<Response> => {
    const { bundle, requested } = locate(url.pathname, sitePath)
    if (!bundle) return text('Not Found', 404)
    const cors = options.site?.cors
    if (isPreflight(request) && cors && (cors.any || cors.origins.size > 0))
      return preflightResponse(cors, request, SITE_METHODS)

    // Back-office routes are not routes here at all.
    const found = find(bundle.routes.filter(onSite), requested, request.method.toUpperCase())
    if ('refused' in found) return found.refused
    const { route, params } = found
    const limiter = limiters.get(route)

    if (limiter && route.rateLimit?.by === 'caller') {
      const address = options.site?.callerAddress(request) ?? 'unknown'
      const wait = limiter.take(address)
      if (wait) return tooMany(wait)
    }
    if (routeAudience(route) === 'public')
      return dispatch(bundle, route, { request, url, params, caller: PUBLIC_CALLER })

    const identified = await identify(request, route)
    if ('refused' in identified) return identified.refused
    const { caller } = identified
    if (limiter && route.rateLimit?.by === 'member') {
      const wait = limiter.take(caller.member.key.toLowerCase())
      if (wait) return tooMany(wait)
    }
    const response = await dispatch(bundle, route, {
      request,
      url,
      params,
      caller,
      member: caller.member,
    })
    // One member's answer is never a shared cache's to keep.
    if (!response.headers.has('cache-control'))
      try {
        response.headers.set('cache-control', 'private, no-store')
      } catch {
        // A response built with immutable headers keeps them.
      }
    return response
  }

  return {
    mounted,
    basePath,
    sitePath,
    async handle(request, url, principal) {
      const pathname = url.pathname
      if (!pathname.startsWith(basePath)) return undefined
      const { bundle, requested } = locate(pathname, basePath)
      if (!bundle) return undefined

      // Authorisation is the host's, not the bundle's: every route is gated on
      // the declared section, and a bundle has no way to opt a route out.
      if (!hasSection(principal, bundle.section)) return new Response('Forbidden', { status: 403 })

      const routes = bundle.routes.filter((route) => !onSite(route))
      const found = find(routes, requested, request.method.toUpperCase())
      if ('refused' in found)
        return new Response(found.refused.status === 405 ? 'Method Not Allowed' : 'Not Found', {
          status: found.refused.status,
        })
      return dispatch(bundle, found.route, {
        request,
        url,
        params: found.params,
        principal,
        caller: Object.freeze({ kind: 'backoffice', principal }),
      })
    },
    async site(request, url) {
      if (!url.pathname.startsWith(sitePath)) return undefined
      const response = await answerSite(request, url)
      const cors = options.site?.cors
      return cors ? withCors(cors, request, response) : response
    },
  }
}

const PUBLIC_CALLER: BundleCaller = Object.freeze({ kind: 'public' })
