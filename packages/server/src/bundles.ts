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
 *   with the declarative builder in `@crombolo/data`, in a schema or file of
 *   its own, and `context.bundle.database`, a Kysely handle on the connection
 *   that reaches only them (`docs/bundles.md`, Part 4; story 189).
 *
 * Deliberately not offered: crombolo's own `Db`, and anything that writes the
 * site's files.
 */

import { hasCultureAccess, hasSection, type Principal } from '@crombolo/api-management/domain'
import {
  BUNDLE_ID,
  BUNDLE_SCHEMA_VERSION,
  type BundlePackage,
  peerRangeProblem,
  schemaProblem,
} from '@crombolo/backoffice-host/registry'
import type { Middleware, RouteMethod, SiteRoute } from '@crombolo/common'
import {
  type AppAlias,
  type ExtensionSectionAlias,
  isExtensionSectionAlias,
  MEMBER_FILE_TYPES,
  SECTION_ALIASES,
} from '@crombolo/core'
import {
  type BundleTables,
  bundleTablesCompatibility,
  compileTables,
  type Db,
  type RedirectMatchKind,
  RedirectRepository,
  type RedirectRow,
  type RedirectTargetKind,
  SITE_OWNER,
  type TablesDatabase,
} from '@crombolo/data'
import {
  normaliseRedirectPath,
  type PublishedCache,
  type PublishedContent,
  type RequestMember,
  type SiteServices,
} from '@crombolo/render'
import { anonymiseProblems } from './anonymise-rules.ts'
import {
  declaredPermissions,
  disabledResponse,
  gated,
  permissionProblems,
} from './bundle-grants.ts'
import type { BundleMedia, BundleMediaDeclaration } from './bundle-media.ts'
import type { BundleForms } from './form-types.ts'
import type { BundleIdentityProviders } from './identity-provider-overrides.ts'
import { type JobInfo, type JobSchedule, jobProblems, type OwnerJobs } from './owner-jobs.ts'
import type { DeclaredRoute } from './routes.ts'
import type { BundleEvents } from './webhooks.ts'

/** The segment every bundle's routes hang below, inside the plugin API. */
export const BUNDLE_API_SEGMENT = 'bundle'

/**
 * A back-office route's path below the bundle's namespace. Literal segments,
 * optionally one `:name` parameter each, and no leading or trailing slash — so
 * a path cannot traverse, and `''` means the namespace root.
 */
const ROUTE_PATH =
  /^(?:[a-z0-9][a-z0-9-]*|:[a-z][a-z0-9]*)(?:\/(?:[a-z0-9][a-z0-9-]*|:[a-z][a-z0-9]*))*$/

export type BundleMethod = RouteMethod

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
  'identityProviders',
  'media',
]

/**
 * What a handler is handed: the declared capabilities, and for a bundle that
 * declares tables, `database`, typed from the declaration (story 189).
 */
export type HostFor<C extends BundleCapability, T extends BundleTables> = Pick<BundleHost, C> & {
  /** Only for a bundle that declares tables: a Kysely handle on them and nothing else. */
  readonly database: TablesDatabase<T>
  /** Only for a bundle that declares jobs: queue one, or read how one is going (story 187). */
  readonly jobs: OwnerJobs
}

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
 * Who a request is from, as the host resolved it before dispatch: a back-office
 * route's user, a signed-in member, or the public. Frozen.
 */
export type BundleCaller =
  | { readonly kind: 'backoffice'; readonly principal: Principal }
  | { readonly kind: 'member'; readonly member: BundleMember; readonly via: 'cookie' | 'token' }
  | { readonly kind: 'public' }
  /** A background job (story 187): nobody, treated as the public. */
  | { readonly kind: 'job' }

/**
 * What a bundle's route handler is given besides 211's context: its declared
 * capabilities, acting for the caller, and on a back-office route the user.
 */
export interface BundleRouteContext<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> {
  /** Only what the bundle declared, frozen. */
  bundle: HostFor<C, T>
  caller: BundleCaller
  /** On a back-office route: already authenticated, and holding the bundle's section. */
  principal?: Principal
}

/**
 * A bundle's route (story 211): 211's contract, with its capabilities in the
 * context. `audience: 'backoffice'` answers below the bundle's back-office
 * namespace at a relative path; otherwise it answers on the site at its path.
 */
export type BundleRoute<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
> = SiteRoute<SiteServices, RequestMember, BundleRouteContext<C, T>>

const onSite = (route: BundleRoute) => route.options.audience !== 'backoffice'

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
  /** Its routes, in 211's contract: back-office ones for its screens, site ones at their paths. */
  routes?: readonly BundleRoute<C, T>[]
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
  /**
   * Middleware the bundle offers a site (story 210). It runs only where the
   * site lists it in its config's `middleware`: installing a bundle never adds
   * to the chain by itself.
   */
  middleware?: Middleware<SiteServices, PublishedContent, RequestMember>
  /**
   * Its background jobs, by name (story 187): each `(payload, context)`, given
   * its capabilities for no caller and its own `database`, as a public route
   * would be, with `context.job` for its progress and its signal.
   */
  jobs?: Record<string, BundleJob<C, T>>
  /** When its jobs run by themselves: cron expressions in a timezone. */
  schedules?: readonly JobSchedule[]
}

/** A bundle's background job (story 187). */
export type BundleJob<
  C extends BundleCapability = BundleCapability,
  T extends BundleTables = BundleTables,
  // biome-ignore lint/suspicious/noExplicitAny: a payload is the bundle's to type
  P = any,
> = (payload: P, context: { bundle: HostFor<C, T>; job: JobInfo }) => unknown

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
  routes: readonly { methods: readonly string[]; path: string; audience: 'site' | 'backoffice' }[]
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
    if ((bundle.capabilities as readonly string[]).includes('tables'))
      problems.push(
        `Bundle "${label}" asks for "tables", which is gone: declaring tables gives its handlers context.bundle.database (docs/bundles.md, Part 4).`,
      )
    if (bundle.tables && bundle.id === SITE_OWNER)
      problems.push(
        `Bundle "${label}" declares tables under the id "${SITE_OWNER}", which names the site's own tables.`,
      )
    if (bundle.tables) {
      if (bundle.tables.id !== bundle.id)
        problems.push(
          `Bundle "${label}" declares its tables under the id "${bundle.tables.id}"; a bundle's tables are under its own id.`,
        )
      const owner = packages.find((pkg) => pkg.id === bundle.id)
      const compiled = compileTables(bundle.tables, owner?.version)
      for (const problem of compiled.problems)
        problems.push(`Bundle "${label}" tables: ${problem}.`)
      if (owner?.field.anonymise !== undefined && compiled.problems.length === 0)
        for (const problem of anonymiseProblems(owner.field.anonymise, compiled.schema))
          problems.push(`Bundle "${label}"'s package.json: crombolo.${problem}.`)
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
    if (!bundle.tables && packages.find((pkg) => pkg.id === bundle.id)?.field.anonymise)
      problems.push(
        `Bundle "${label}"'s package.json declares "crombolo.anonymise", and the bundle declares no tables for it to describe.`,
      )
    for (const problem of mediaProblems(bundle))
      problems.push(`Bundle "${label}" media: ${problem}.`)
    problems.push(...jobProblems(`Bundle "${label}"`, bundle.jobs, bundle.schedules))
    {
      const pkg = packages.find((candidate) => candidate.id === bundle.id)
      if (pkg?.carries.server && Array.isArray(pkg.field.permissions))
        problems.push(...permissionProblems(label, bundle.capabilities, declaredPermissions(pkg)))
    }
    const owner = packages.find((pkg) => pkg.id === bundle.id)
    if (owner?.carries.server && (owner.field.schemaVersion ?? 1) < BUNDLE_SCHEMA_VERSION)
      problems.push(`Bundle "${label}": ${schemaProblem(owner.field.schemaVersion ?? 1)}.`)
    const routes = new Set<string>()
    for (const route of bundle.routes ?? []) {
      if (!route || typeof route !== 'object' || !route.handlers || !route.options) {
        problems.push(`Bundle "${label}" declares a route not built with route(path, handlers).`)
        continue
      }
      if (!onSite(route) && route.path !== '' && !ROUTE_PATH.test(route.path))
        problems.push(
          `Bundle "${label}" declares the back-office route "${route.path}", which is not a plain path of segments below its namespace.`,
        )
      if (
        !onSite(route) &&
        (route.options.members || route.options.rateLimit || route.options.cors)
      )
        problems.push(
          `Bundle "${label}" route "${route.path}": members, rateLimit and cors apply to site routes, not back-office ones.`,
        )
      const where = onSite(route) ? 'site' : 'backoffice'
      if (routes.has(`${where} ${route.path}`))
        problems.push(`Bundle "${label}" declares the route "${route.path}" twice.`)
      routes.add(`${where} ${route.path}`)
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

/** Member group names a site route requires, for checking at boot that they exist. */
export function bundleRouteGroups(bundles: readonly ServerBundle[]): string[] {
  const groups = new Set<string>()
  for (const bundle of bundles)
    for (const route of bundle.routes ?? []) {
      const members = route.options.members
      if (typeof members === 'object') for (const group of members.groups) groups.add(group)
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
  [K in BundleCapability]?: (caller: BundleCaller, bundle: ServerBundle) => BundleHost[K]
}

export interface ServerBundlesOptions {
  bundles: readonly ServerBundle[]
  /** The bundle packages the site depends on, from discovery. */
  packages: readonly BundlePackage[]
  /** The running release, which every bundle's peer range must admit. */
  coreVersion: string
  /** `<backoffice>/crombolo/api`, from `createBackOfficePaths`. */
  pluginApiPath: string
  host: Omit<BundleHost, 'media'> & { media?: BundleMedia }
  /** Capabilities built per request from the caller, in place of the ones in `host`. */
  callerHost?: CallerCapabilities
  /** Named per bundle, so a log line says which one wrote it. */
  log(bundleId: string): BundleLog
  /** A bundle's own tables, on the connection that reaches only them; absent where none are. */
  database?(bundle: ServerBundle): TablesDatabase | undefined
  /**
   * Whether a bundle is turned on: its grant covers what it declares (story
   * 222). A bundle that is off answers every route as waiting. Absent, all are on.
   */
  isOn?(bundleId: string): boolean
  /** A bundle's queue, recording who queued from the caller (story 187). */
  jobs?(bundleId: string, queuedBy: string | null): OwnerJobs
}

/** Runs a route through 211's pipeline: the server's `routes.invoke`. */
export type RouteInvoker = (
  entry: DeclaredRoute,
  request: Request,
  url: URL,
  params: Record<string, string>,
  options?: { checks: boolean; extra?: Record<string, unknown> },
) => Promise<Response>

export interface ServerBundles {
  readonly mounted: readonly MountedBundle[]
  /** The prefix every back-office bundle route sits below, including the trailing slash. */
  readonly basePath: string
  /**
   * Answers a request in the back-office namespace through `invoke`.
   * `undefined` means the path belongs to no bundle, so the caller falls
   * through to its own 404.
   */
  handle(
    request: Request,
    url: URL,
    principal: Principal,
    invoke: RouteInvoker,
  ): Promise<Response | undefined>
  /** The bundles' site routes, for the server's route table, each given its bundle's capabilities. */
  siteRoutes(): DeclaredRoute[]
  /** What a bundle's job is given: its capabilities for no caller, as on a public route (story 187). */
  jobContext(bundleId: string): Pick<BundleHost, BundleCapability> | undefined
}

const JOB_CALLER: BundleCaller = Object.freeze({ kind: 'job' })

/** Who queued a job, for administrators to read: it grants nothing. */
const queuedByOf = (caller: BundleCaller): string | null =>
  caller.kind === 'member'
    ? `member ${caller.member.username}`
    : caller.kind === 'backoffice'
      ? `user ${caller.principal.email}`
      : caller.kind === 'job'
        ? 'a job'
        : 'a visitor'

const freezeMember = (member: RequestMember): BundleMember =>
  Object.freeze({
    key: member.key,
    name: member.name,
    username: member.username,
    email: member.email,
    groups: Object.freeze([...member.roles]),
  })

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
      routes: (bundle.routes ?? []).map((route) => ({
        methods: Object.keys(route.handlers),
        path: route.path,
        audience: onSite(route) ? ('site' as const) : ('backoffice' as const),
      })),
    }
  })

  // Made once per bundle, at its first request, each on its own tables alone.
  const databases = new Map<string, TablesDatabase>()
  const databaseOf = (bundle: ServerBundle): TablesDatabase | undefined => {
    if (!bundle.tables) return undefined
    let opened = databases.get(bundle.id)
    if (!opened) {
      opened = options.database?.(bundle)
      if (!opened) return undefined
      databases.set(bundle.id, opened)
    }
    return opened
  }
  /** Only the declared capabilities, frozen, so a handler cannot reach further. */
  const contextFor = (
    bundle: ServerBundle,
    caller: BundleCaller,
  ): Pick<BundleHost, BundleCapability> => {
    const host: Record<string, unknown> = {}
    const declared = declaredPermissions(owners.get(bundle.id))
    for (const capability of bundle.capabilities) {
      const forCaller = options.callerHost?.[capability]
      const given = forCaller
        ? forCaller(caller, bundle)
        : capability === 'log'
          ? (logs.get(bundle.id) as BundleLog)
          : options.host[capability]
      // Only what its declared permissions allow (story 222).
      host[capability] = given ? gated(bundle.id, capability, given, declared) : given
    }
    const database = databaseOf(bundle)
    if (database) host.database = database
    if (bundle.jobs && options.jobs) host.jobs = options.jobs(bundle.id, queuedByOf(caller))
    return Object.freeze(host) as Pick<BundleHost, BundleCapability>
  }

  /** A site route that answers as waiting while its bundle is off. */
  const whileOn = (bundleId: string, route: SiteRoute): SiteRoute => {
    const isOn = options.isOn
    if (!isOn) return route
    const handlers: SiteRoute['handlers'] = {}
    for (const [method, handler] of Object.entries(route.handlers))
      handlers[method as RouteMethod] = (request, context) =>
        isOn(bundleId) ? handler(request, context) : disabledResponse(bundleId)
    return { ...route, handlers }
  }

  return {
    mounted,
    basePath,
    jobContext(bundleId) {
      const bundle = byId.get(bundleId)
      return bundle ? contextFor(bundle, JOB_CALLER) : undefined
    },
    siteRoutes() {
      return options.bundles.flatMap((bundle) =>
        (bundle.routes ?? []).filter(onSite).map(
          (route): DeclaredRoute => ({
            route: whileOn(bundle.id, route as SiteRoute),
            owner: `the bundle ${bundle.id}`,
            extra: ({ member, via }) => {
              const caller: BundleCaller = member
                ? Object.freeze({
                    kind: 'member',
                    member: freezeMember(member as RequestMember),
                    via,
                  })
                : PUBLIC_CALLER
              return { bundle: contextFor(bundle, caller), caller }
            },
          }),
        ),
      )
    },
    async handle(request, url, principal, invoke) {
      const pathname = url.pathname
      if (!pathname.startsWith(basePath)) return undefined
      const rest = pathname.slice(basePath.length)
      const slash = rest.indexOf('/')
      const bundle = byId.get(slash === -1 ? rest : rest.slice(0, slash))
      if (!bundle) return undefined
      const requested = (slash === -1 ? '' : rest.slice(slash + 1)).replace(/\/$/, '')

      // Authorisation is the host's, not the bundle's: every route is gated on
      // the declared section, and a bundle has no way to opt a route out.
      if (!hasSection(principal, bundle.section)) return new Response('Forbidden', { status: 403 })

      for (const route of (bundle.routes ?? []).filter((candidate) => !onSite(candidate))) {
        const params = matchRoute(route.path, requested)
        if (!params) continue
        if (options.isOn && !options.isOn(bundle.id)) return disabledResponse(bundle.id)
        const caller: BundleCaller = Object.freeze({ kind: 'backoffice', principal })
        return invoke(
          { route: route as SiteRoute, owner: `the bundle ${bundle.id}` },
          request,
          url,
          params,
          {
            checks: false,
            extra: { bundle: contextFor(bundle, caller), caller, principal },
          },
        )
      }
      return new Response('Not Found', { status: 404 })
    },
  }
}

const PUBLIC_CALLER: BundleCaller = Object.freeze({ kind: 'public' })
