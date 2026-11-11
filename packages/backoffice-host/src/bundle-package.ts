/**
 * A bundle is an npm package whose `package.json` carries the bundle manifest in
 * its `crombolo` field. `docs/bundles.md`.
 *
 * This is the one place that field is read and validated, so discovery, the
 * marketplace, the server half and the installer cannot disagree about what a
 * bundle is.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { BACKOFFICE_CODE, permissionsProblem, readSettings } from './bundle-permissions.ts'
import { packageInRoot, readRecord, rootOf } from './extension-roots.ts'
import type { PackageManifestImportmap } from './manifests.ts'

/** The package a bundle declares its peer range on. */
export const CORE_PACKAGE = '@crombolo/crombolo'

/**
 * A bundle's id: its route segment, its log name, and the prefix of anything
 * else it owns. Lowercase, no dots or slashes, so it cannot climb out of a
 * namespace however it is spelled.
 */
export const BUNDLE_ID = /^[a-z][a-z0-9-]{1,38}$/

/** The payload's manifest, at the package root (story 193). */
export const PAYLOAD_MANIFEST = 'bundle.json'

/** An exported binding name: what a site imports to wire the server half. */
const EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * What a bundle is (story 306): a site package, made from a site to move it and
 * only ever applied from a file, or an extension, installed as a dependency.
 * Every bundle says which.
 */
export type BundleType = 'site' | 'extension'

/** Said when a bundle does not say what it is. */
export const UNTYPED_BUNDLE =
  'it does not say what it is: its package.json needs "crombolo.bundleType", "site" or "extension"'

/** Said when a site package is offered as a dependency. */
export const SITE_PACKAGE_NOT_INSTALLED =
  'it is a site package, which is applied to a site with `crombolo site apply`, never installed'

/** The `crombolo` field, as a bundle declares it. */
export interface CromboloField {
  id: string
  /** A site package or an extension (story 306); required. */
  bundleType: BundleType
  name?: string
  allowPublicAccess?: boolean
  allowTelemetry?: boolean
  /** The backoffice half: Umbraco extension manifests. */
  extensions?: unknown[]
  importmap?: PackageManifestImportmap
  /** The package carries content: `bundle.json` at its root, and what it lists beside it. */
  content?: true
  /** The factory the package exports for the server half. Never imported by core. */
  server?: string
  /**
   * The bundle schema its server half is written for; absent means 1. This
   * release reads `BUNDLE_SCHEMA_VERSION`.
   */
  schemaVersion?: number
  /**
   * What this release's table steps promise a running site, for a bundle that
   * owns tables: `breaking` exactly when it ships a contract.
   */
  migrations?: 'compatible' | 'breaking'
  /**
   * Under an anonymised export, each of its tables that may travel, and how
   * (story 189): `keep`, or its columns as `member`, `email` or `scrub`. A
   * table it does not name travels empty.
   */
  anonymise?: Record<string, 'keep' | Record<string, 'member' | 'email' | 'scrub'>>
  /**
   * What it may do with the site (stories 222, 308), granted as a whole. From
   * schema 4, each permission with its reason; schema 3 listed names only.
   */
  permissions?: string[] | Record<string, string | { reason: string; origins?: string[] }>
  /** What it may be set to, by the config or in the back office (story 310). */
  settings?: Record<string, unknown>
}

/**
 * The bundle schema this release writes: 6 lets a manifest entry name a screen
 * its server half describes (story 323); 5 put its server half in `src/server/`
 * and its back-office code in `src/backoffice/` (story 320); 4 gave each
 * permission a reason (308); 3 declared them (222); 2 made its routes route
 * handlers (211).
 */
export const BUNDLE_SCHEMA_VERSION = 6

/** The schema whose manifest entries may name a described screen (story 323). */
export const SCREEN_SCHEMA_VERSION = 6

const SCREEN_ID = /^[a-z][a-z0-9-]{0,39}$/

/**
 * Why its manifest's entries cannot name the screens they do (story 323): a
 * screen needs schema 6 and a server half to describe it, and an entry names a
 * screen or a module, never both. Pure.
 */
export function screenEntryProblems(f: Record<string, unknown>, schema: number): string[] {
  if (!Array.isArray(f.extensions)) return []
  const problems: string[] = []
  for (const entry of f.extensions) {
    if (!isPlainObject(entry) || entry.screen === undefined) continue
    const alias = typeof entry.alias === 'string' ? entry.alias : 'an entry'
    if (typeof entry.screen !== 'string' || !SCREEN_ID.test(entry.screen))
      problems.push(
        `${alias} names the screen ${JSON.stringify(entry.screen)}, which is not a screen id`,
      )
    else if (schema < SCREEN_SCHEMA_VERSION)
      problems.push(
        `${alias} names a screen, which needs "crombolo.schemaVersion": ${SCREEN_SCHEMA_VERSION}`,
      )
    if (entry.element !== undefined || entry.js !== undefined)
      problems.push(`${alias} names a screen and a module: it is drawn from one or the other`)
    if (f.server === undefined)
      problems.push(`${alias} names a screen, and the package has no server half to describe it`)
  }
  return problems
}

/** The oldest schema read: an extension at 4 or before is refused until it is migrated (story 320). */
export const OLDEST_BUNDLE_SCHEMA_VERSION = 5

/**
 * The oldest server half the site's config may still wire in itself: its own
 * code, run in the CMS, so the layout does not apply, only the routes and
 * permissions it is written against (stories 211, 222).
 */
export const OLDEST_WIRED_SCHEMA_VERSION = 3

/** Where an extension's server half lives (story 320). */
export const SERVER_DIR = 'src/server'

/** Where an extension's back-office code lives (story 320). */
export const BACKOFFICE_DIR = 'src/backoffice'

/** The manifest keys that name a module, in an entry and nested in it. */
const MODULE_KEYS = new Set(['element', 'api', 'js', 'loader'])

/**
 * Every module an extension's manifest names: its entries' `element`, `api`,
 * `js` and `loader`, however deep, and its import map's targets. Pure.
 */
export function backOfficeModules(field: { extensions?: unknown; importmap?: unknown }): string[] {
  const found = new Set<string>()
  const walk = (value: unknown) => {
    if (Array.isArray(value)) for (const item of value) walk(item)
    else if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (MODULE_KEYS.has(key) && typeof item === 'string') found.add(item)
        else walk(item)
      }
  }
  walk(field.extensions)
  const importmap = field.importmap as
    | { imports?: Record<string, unknown>; scopes?: Record<string, Record<string, unknown>> }
    | undefined
  for (const target of Object.values(importmap?.imports ?? {}))
    if (typeof target === 'string') found.add(target)
  for (const scope of Object.values(importmap?.scopes ?? {}))
    for (const target of Object.values(scope ?? {}))
      if (typeof target === 'string') found.add(target)
  return [...found]
}

/** A module path as the package names it, without a leading `./`. */
const packagePath = (path: string) => path.replace(/^\.\//, '')

const SOURCE_FILE = /\.(m?[jt]s|[jt]sx)$/

/** The entry a package exports, as its `package.json` says, relative to the package. */
export function exportedEntry(json: PackageJson): string | undefined {
  const pick = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const conditions = value as Record<string, unknown>
      if ('.' in conditions) return pick(conditions['.'])
      for (const key of ['bun', 'import', 'default', 'node', 'require'])
        if (key in conditions) return pick(conditions[key])
    }
    return undefined
  }
  const entry = pick(json.exports) ?? json.main
  return entry ? packagePath(entry) : undefined
}

/** Said when a schema 3 extension is offered for a new install (story 308). */
export const SCHEMA_3_NOT_INSTALLED =
  'it asks for permissions without saying why (bundle schema 3); install a version written for schema 5'

/** A bundle as read from its package. */
export interface BundlePackage {
  packageName: string
  version: string
  directory: string
  id: string
  name: string
  /** `peerDependencies["@crombolo/crombolo"]`. */
  peerRange: string
  private: boolean
  bundleType: BundleType
  field: CromboloField
  /** The package's directory, when it carries content: the payload is the package. */
  contentDir: string | undefined
  carries: { extensions: boolean; content: boolean; server: boolean }
  /** Its root, `extensions/<id>/`, when it was installed into one (story 326). */
  root?: string
  /**
   * An extension the site lists as a dependency, the way before story 326: run
   * only when the site's config wires it, as the site's own code.
   */
  dependency?: true
  /**
   * A dependency that is a link to a package on this machine, a workspace's or
   * one `bun link` made: a developer's, allowed outside production (story 326).
   */
  linked?: true
}

export interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  exports?: unknown
  main?: string
  crombolo?: unknown
}

export function readPackageJson(file: string): PackageJson | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PackageJson)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a package's `crombolo` field declares a bundle at all.
 *
 * Core's own umbrella package carries a `crombolo` field too — its release
 * declaration — so the core package is never a bundle, whatever it holds.
 */
export function declaresBundle(json: PackageJson | undefined): boolean {
  return Boolean(json?.crombolo) && json?.name !== CORE_PACKAGE
}

/** What an extension written for an older schema must change, by the schema it is at. */
export function schemaProblem(schema: number, options: { wired?: boolean } = {}): string {
  const changes = [
    schema < 2 ? 'its routes are route handlers since 0.37 (docs/bundles.md, "Routes")' : '',
    schema < 3
      ? 'it declares the permissions it needs in "crombolo.permissions" (docs/bundles.md, "Permissions")'
      : '',
    schema < 4 && !options.wired ? 'each permission gives its reason' : '',
    options.wired
      ? ''
      : `its server code moves to ${SERVER_DIR}/ and its back-office code to ${BACKOFFICE_DIR}/, which \`crombolo extension migrate <dir>\` does`,
  ].filter(Boolean)
  const reads = options.wired ? OLDEST_WIRED_SCHEMA_VERSION : BUNDLE_SCHEMA_VERSION
  return `it is written for bundle schema ${schema}, and this release reads ${reads}${options.wired ? ` to ${BUNDLE_SCHEMA_VERSION}` : ''}: ${changes.join(', and ')}, with "crombolo.schemaVersion": ${BUNDLE_SCHEMA_VERSION}${options.wired ? '' : '; then publish it again'}`
}

/**
 * Where an extension's files must sit (story 320): its exported entry under
 * `src/server/`, every module its manifest names under `src/backoffice/`, and
 * nothing in the layout before it. Pure but for reading the directory.
 */
function layoutProblems(
  json: PackageJson,
  f: Record<string, unknown>,
  directory?: string,
): string[] {
  const problems: string[] = []
  for (const module of backOfficeModules(f)) {
    const path = packagePath(module)
    if (module.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(module) || path.includes('..'))
      problems.push(`its manifest names ${module}, which is not a file under ${BACKOFFICE_DIR}/`)
    else if (!path.startsWith(`${BACKOFFICE_DIR}/`) || !SOURCE_FILE.test(path))
      problems.push(
        `its manifest names ${path}, and its back-office code is a .ts or .js file under ${BACKOFFICE_DIR}/`,
      )
    else if (directory && !existsSync(join(directory, path)))
      problems.push(`its manifest names ${path}, which it does not hold`)
  }
  // One the site's config wires in itself may export nothing: the config holds its code.
  const entry = f.server !== undefined ? exportedEntry(json) : undefined
  if (entry && !entry.startsWith(`${SERVER_DIR}/`))
    problems.push(
      `its server half is the entry its package exports, which must be under ${SERVER_DIR}/, not ${entry}`,
    )
  if (directory) {
    if (existsSync(join(directory, 'plugin')))
      problems.push(
        `it holds plugin/, the layout before bundle schema 5: its back-office code belongs in ${BACKOFFICE_DIR}/`,
      )
    const src = join(directory, 'src')
    if (isDirectory(src))
      for (const name of readdirSync(src))
        if (name !== 'server' && name !== 'backoffice')
          problems.push(
            `it holds src/${name}, and an extension's code is under ${SERVER_DIR}/ or ${BACKOFFICE_DIR}/`,
          )
  }
  return problems
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The shape of `crombolo.anonymise`; whether its tables and columns exist is the server's to check. */
function isAnonymiseRules(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return Object.values(value).every(
    (rule) =>
      rule === 'keep' ||
      (isPlainObject(rule) &&
        Object.values(rule).every((how) => how === 'member' || how === 'email' || how === 'scrub')),
  )
}

/**
 * Every reason a package's manifest is not a bundle, reported together.
 *
 * `directory` is where the package lives, so `content` can be checked against
 * what is really there; a packument read from the registry has none, and only
 * the declaration is checked.
 */
export function validateBundlePackage(json: PackageJson, directory?: string): string[] {
  const problems: string[] = []
  const field = json.crombolo
  if (!field || typeof field !== 'object' || Array.isArray(field))
    return ['its package.json has no "crombolo" field, so it is not a bundle']
  const f = field as Record<string, unknown>

  if (typeof f.id !== 'string' || !BUNDLE_ID.test(f.id))
    problems.push(
      `"crombolo.id" must be 2–39 lowercase letters, digits and hyphens starting with a letter${
        typeof f.id === 'string' ? `, not "${f.id}"` : ''
      }`,
    )
  if (f.bundleType !== 'site' && f.bundleType !== 'extension') problems.push(UNTYPED_BUNDLE)
  else if (f.bundleType === 'site') {
    // A site's own extensions travel as dependencies in the package.json it carries.
    for (const key of ['server', 'extensions', 'permissions', 'importmap'])
      if (f[key] !== undefined)
        problems.push(
          `it is a site package, which declares no "crombolo.${key}": that is an extension's`,
        )
    if (json.private !== true)
      problems.push(
        'it is a site package, which is never published: its package.json needs "private": true',
      )
  }
  if (f.name !== undefined && (typeof f.name !== 'string' || f.name.trim() === ''))
    problems.push('"crombolo.name" must be a non-empty string')
  if (typeof json.name !== 'string' || json.name === '')
    problems.push('its package.json has no "name"')
  if (typeof json.version !== 'string' || json.version === '')
    problems.push('its package.json has no "version"')

  if (f.extensions !== undefined && !Array.isArray(f.extensions))
    problems.push('"crombolo.extensions" must be a list of extension manifests')
  if (f.migrations !== undefined && f.migrations !== 'compatible' && f.migrations !== 'breaking')
    problems.push('"crombolo.migrations" is "compatible" or "breaking"')
  if (f.anonymise !== undefined && !isAnonymiseRules(f.anonymise))
    problems.push(
      '"crombolo.anonymise" maps each table to "keep" or to its columns as "member", "email" or "scrub"',
    )
  if (f.server !== undefined && (typeof f.server !== 'string' || !EXPORT_NAME.test(f.server)))
    problems.push('"crombolo.server" must name the factory the package exports')
  // Code of either half: a server, or a module the back office would load.
  const modules = backOfficeModules(f)
  const hasCode = f.server !== undefined || modules.length > 0
  const schema = (f.schemaVersion as number | undefined) ?? 1
  if (
    f.schemaVersion !== undefined &&
    (!Number.isInteger(f.schemaVersion) || (f.schemaVersion as number) < 1)
  )
    problems.push('"crombolo.schemaVersion" is a whole number')
  else if (hasCode && schema < OLDEST_BUNDLE_SCHEMA_VERSION) problems.push(schemaProblem(schema))
  else if (hasCode) problems.push(...layoutProblems(json, f, directory))
  if (hasCode && f.permissions === undefined)
    problems.push(
      'it declares no "crombolo.permissions": each permission it asks for with its reason, {} for nothing (docs/bundles.md, "Permissions")',
    )
  else if (f.permissions !== undefined) {
    const problem = permissionsProblem(f.permissions, schema)
    if (problem) problems.push(problem)
    else if (schema >= OLDEST_BUNDLE_SCHEMA_VERSION) {
      const asksForCode = Object.hasOwn(f.permissions as object, BACKOFFICE_CODE)
      if (modules.length > 0 && !asksForCode)
        problems.push(
          `it runs code in the back office and does not ask for "${BACKOFFICE_CODE}": that code acts as whoever is signed in, so it is asked for, with its reason`,
        )
      if (modules.length === 0 && asksForCode)
        problems.push(`it asks for "${BACKOFFICE_CODE}" and has no back-office code`)
    }
  }
  {
    const settings = readSettings(f.settings)
    if ('problem' in settings) problems.push(settings.problem)
  }
  if (f.content !== undefined) {
    if (typeof f.content === 'string')
      problems.push(
        'it was written before crombolo 0.33.1, with its content in a folder, a layout no longer read; rebuild it with the command that made it',
      )
    else if (f.content !== true)
      problems.push(`"crombolo.content" is true: ${PAYLOAD_MANIFEST} sits at the package root`)
    else if (directory && !existsSync(join(directory, PAYLOAD_MANIFEST)))
      problems.push(`it declares content, and holds no ${PAYLOAD_MANIFEST} at its root`)
  }

  if (f.bundleType === 'extension' && directory) {
    const code = carriedCode(directory)
    if (code)
      problems.push(
        `it is an extension, which never carries the site's code, and ${PAYLOAD_MANIFEST} lists ${code}`,
      )
  }

  problems.push(...screenEntryProblems(f, schema))

  const hasExtensions = Array.isArray(f.extensions) && f.extensions.length > 0
  if (!hasExtensions && f.content === undefined && f.server === undefined)
    problems.push(
      'it declares no "extensions", "content" or "server", so it is a bundle that does nothing',
    )

  const peer = json.peerDependencies?.[CORE_PACKAGE]
  if (typeof peer !== 'string' || peer.trim() === '')
    problems.push(`its package.json declares no peerDependencies["${CORE_PACKAGE}"]`)
  return problems
}

/** What a bundle's `bundle.json` lists under `code/`, said briefly; undefined when nothing. */
function carriedCode(directory: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, PAYLOAD_MANIFEST), 'utf8')) as {
      carries?: { code?: unknown[] }
    }
    const code = manifest.carries?.code ?? []
    return code.length > 0 ? `${code.length} file(s) under code/` : undefined
  } catch {
    return undefined
  }
}

/**
 * The package at a directory, read as a bundle.
 *
 * `undefined` with no problems means the package is not a bundle at all — an
 * ordinary dependency. Problems mean it claims to be one and is malformed.
 */
export function readBundlePackage(directory: string): {
  bundle: BundlePackage | undefined
  problems: string[]
  /** Its only fault is that it does not say what it is: an extension from before 306, turned off. */
  untyped?: { id: string }
} {
  const json = readPackageJson(join(directory, 'package.json'))
  if (!declaresBundle(json)) return { bundle: undefined, problems: [] }
  const problems = validateBundlePackage(json as PackageJson, directory)
  const declared = (json as PackageJson).crombolo as Record<string, unknown>
  if (problems.length === 1 && problems[0] === UNTYPED_BUNDLE && typeof declared.id === 'string')
    return { bundle: undefined, problems, untyped: { id: declared.id } }
  if (problems.length > 0) return { bundle: undefined, problems }
  const pkg = json as Required<Pick<PackageJson, 'name' | 'version'>> & PackageJson
  const field = pkg.crombolo as CromboloField
  return {
    bundle: {
      packageName: pkg.name,
      version: pkg.version,
      directory,
      id: field.id,
      name: field.name ?? pkg.name,
      peerRange: pkg.peerDependencies?.[CORE_PACKAGE] as string,
      private: pkg.private === true,
      bundleType: field.bundleType,
      field,
      contentDir: field.content === true ? directory : undefined,
      carries: {
        extensions: Array.isArray(field.extensions) && field.extensions.length > 0,
        content: field.content !== undefined,
        server: field.server !== undefined,
      },
    },
    problems: [],
  }
}

const COMPARATOR = /^(?:[~^]|[<>]=?|=)?v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?$/

/** A semver range, token by token: Bun's own matcher accepts nonsense and matches it. */
export function isSemverRange(range: string): boolean {
  const tokens = range.trim().split(/\s+/)
  return tokens.length > 0 && tokens.every((t) => t === '||' || t === '-' || COMPARATOR.test(t))
}

/** Whether a bundle's peer range admits a core version; a reason when it does not. */
export function peerRangeProblem(bundle: BundlePackage, coreVersion: string): string | undefined {
  // A workspace link is resolved to this very tree, so it is this version by construction.
  if (bundle.peerRange.startsWith('workspace:')) return undefined
  const satisfied =
    isSemverRange(bundle.peerRange) && Bun.semver.satisfies(coreVersion, bundle.peerRange)
  return satisfied
    ? undefined
    : `${bundle.packageName} (${bundle.id}) is written for ${CORE_PACKAGE} ${bundle.peerRange}, and this site runs ${coreVersion}`
}

/**
 * The directory a dependency resolves to, walking up as Node does, so a
 * workspace root's hoisted `node_modules` is found from a site inside it.
 */
export function resolvePackageDir(from: string, name: string): string | undefined {
  // A name may not climb out of node_modules, whatever a package.json says.
  if (name.includes('..') || name.startsWith('/') || name.startsWith('.')) return undefined
  let dir = normalize(from)
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export interface DiscoveredBundles {
  bundles: BundlePackage[]
  /**
   * A declared dependency that claims to be a bundle and is not a valid one, or
   * is a site package, which is never a dependency. `untyped` names the id of
   * one whose only fault is that it does not say what it is: it is turned off.
   */
  problems: { packageName: string; problems: string[]; untyped?: { id: string } }[]
}

/**
 * Every declared dependency of the site that is a bundle.
 *
 * Only declared dependencies are read, never a walk of `node_modules`, so a
 * transitive dependency cannot claim to be a bundle the site never asked for.
 */
export function discoverBundles(siteDir: string): DiscoveredBundles {
  const json = readPackageJson(join(siteDir, 'package.json'))
  const found: DiscoveredBundles = { bundles: [], problems: [] }
  // Story 326: what the record names, each from its own root.
  const seen = new Set<string>()
  for (const [id, line] of Object.entries(readRecord(siteDir)).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const directory = packageInRoot(siteDir, id, line.name)
    if (!existsSync(join(directory, 'package.json'))) continue
    const read = readBundlePackage(directory)
    seen.add(line.name)
    if (read.bundle?.bundleType === 'site')
      found.problems.push({ packageName: line.name, problems: [SITE_PACKAGE_NOT_INSTALLED] })
    else if (read.bundle) found.bundles.push({ ...read.bundle, root: rootOf(siteDir, id) })
    else if (read.problems.length > 0)
      found.problems.push({
        packageName: line.name,
        problems: read.problems,
        ...(read.untyped ? { untyped: read.untyped } : {}),
      })
  }
  // A peer is declared too: a site whose host provides `@crombolo/*` lists
  // them there (story 192).
  const names = new Set([
    ...Object.keys(json?.dependencies ?? {}),
    ...Object.keys(json?.peerDependencies ?? {}),
  ])
  for (const name of [...names].sort()) {
    if (seen.has(name)) continue
    const directory = resolvePackageDir(siteDir, name)
    if (!directory) continue
    const read = readBundlePackage(directory)
    if (read.bundle?.bundleType === 'site')
      found.problems.push({ packageName: name, problems: [SITE_PACKAGE_NOT_INSTALLED] })
    else if (read.bundle)
      found.bundles.push(
        read.bundle.bundleType !== 'extension'
          ? read.bundle
          : isLinked(directory)
            ? { ...read.bundle, linked: true }
            : { ...read.bundle, dependency: true },
      )
    else if (read.problems.length > 0)
      found.problems.push({
        packageName: name,
        problems: read.problems,
        ...(read.untyped ? { untyped: read.untyped } : {}),
      })
  }
  return found
}

/** Whether a package directory is a link to one elsewhere on this machine, as a workspace's is. */
function isLinked(directory: string): boolean {
  try {
    return lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory
  } catch {
    return false
  }
}

/** Whether a path is a directory, for telling a package path from a package name. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
