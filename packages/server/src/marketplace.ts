/**
 * The Bundles section's marketplace, over npm. `docs/bundles.md`.
 *
 * Discovery and declaration are two different things, because npm indexes only
 * one of them: a bundle is *found* by the `crombolo-bundle` keyword, which is
 * the only thing registry search will match, and it *declares* itself with a
 * `crombolo` field in its `package.json`. Search for the keyword, then read each
 * hit's packument — custom fields survive there — and offer only the packages
 * whose manifest is a valid bundle. A keyword squatter never reaches the list.
 *
 * An install is `bun add`, and then — unless the site or the request says not
 * to — the content the bundle carries, through the same installer as
 * `crombolo extension install`. A bundle's server half is never loaded by an
 * install: that still takes an edit to `crombolo.config.ts` and a deploy.
 *
 * The search is proxied rather than done in the browser: it works where the
 * browser cannot reach npm, and the backoffice keeps making same-origin
 * requests only.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  type AccessLevel,
  askedPermissions,
  type BundlePackage,
  type DeclaredPermission,
  describePermissions,
  EXTENSION_KEYWORD,
  type ExtensionRegistry,
  groupsOf,
  isSchema3Field,
  LEGACY_EXTENSION_KEYWORD,
  levelOf,
  type PackageJson,
  type PermissionGroups,
  readSettings,
  SCHEMA_3_NOT_INSTALLED,
  SITE_PACKAGE_NOT_INSTALLED,
  USER_DELEGATE,
  validateBundlePackage,
} from '@crombolo/backoffice-host'
import {
  LOCAL_BUNDLES_DIR,
  localBundleFileName,
  localBundlePath,
  localBundlesNamed,
} from '@crombolo/transfer'
import {
  type BundleGrants,
  DELEGATE_NEEDS_PERSON,
  declaredEntries,
  declaredPermissions,
  isSchema3,
} from './bundle-grants.ts'
import { siteLayouts } from './components.ts'
import { grantRefusal, type UnrestrictedFrom } from './grant-policy.ts'
import { logger } from './logging.ts'
import {
  type ProvenancePolicy,
  type ProvenanceResult,
  provenanceProblem,
  verifyPackage,
  verifyProvenance,
} from './provenance.ts'
import { extractTarball } from './tar.ts'

const log = logger('packages')

/** Where a registry version's tarball is, and what it hashes to. */
interface Dist {
  tarball?: string
  integrity?: string
}

/** How long a search is reused. Long enough to page a list, short enough to stay fresh. */
const CACHE_MS = 5 * 60 * 1000

export interface MarketplaceListing {
  name: string
  version: string
  description: string
  publisher: string | null
  links: { npm: string; homepage: string | null; repository: string | null }
  /** What the latest version carries; only a valid bundle is listed at all. */
  carries: BundlePackage['carries']
  installedVersion: string | null
}

/** A bundle the site depends on, as the Installed view lists it. */
export interface InstalledListing {
  /** The npm package name, which is what an uninstall names. */
  packageName: string
  /** The display name the package chose. */
  name: string
  id: string
  version: string
  extensionCount: number
  carries: BundlePackage['carries']
  /** Whether its server half is imported into `crombolo.config.ts`; only meaningful when it carries one. */
  wired: boolean
  /** The version whose content was applied here, or null when none has been. */
  contentApplied: string | null
  /** What the package says it is, from its `package.json`; empty when it says nothing. */
  description: string
  /** Who made it, as its `author` says; null when it does not say (story 320). */
  publisher: string | null
  /** The crombolo releases it is written for. */
  peerRange: string
  /** What its server half may do with the site, each with what it allows (story 222). */
  permissions: { permission: string; allows: string }[]
  /** Whether it is turned on: unless an administrator has disabled it. */
  on: boolean
  /** Who disabled it, while it is off. */
  disabledBy: string | null
  /** Who approved it, and when: an administrator at install, or the site's code. */
  granted?: { by: string | null; at: string; version: string }
  /** Where it was built, from its signature (story 060); `local` for a workspace or linked one. */
  provenance: ProvenanceResult
}

/** What became of the content half of an install. */
export interface ContentOutcome {
  applied: boolean
  /** Set when it was applied: the transfer run that can revert it. */
  runId?: string
  message: string
}

export interface MarketplaceOptions {
  registry: string
  keyword: string
  marketplaceUrl: string
  extensions: ExtensionRegistry
  fetch?: typeof fetch
  /** The site's components, whose layouts an extension's page templates may sit in (story 312). */
  componentsDir?: string
  /** Where `bun add` runs, which is the site that owns the package.json. */
  siteDir: string
  /** Overridden by tests; the real one shells out to Bun. */
  install?: PackageInstaller
  /** The ids of the bundles whose server half this node has mounted. */
  wired?: () => readonly string[]
  /** Where an install's grant is recorded, and where the listing reads it (story 222). */
  grants?: Pick<BundleGrants, 'state' | 'grant'>
  /** The version of a package whose content has been applied here. */
  contentApplied?: (packageName: string) => Promise<string | null>
  /**
   * Installs the content half of a bundle the site now depends on. Absent where
   * content cannot be applied, which declines it for every install.
   */
  applyContent?: (packageName: string) => Promise<ContentOutcome>
  /** The site's `applyBundleContentOnInstall`. */
  applyContentOnInstall?: boolean
  /** Where an Unrestricted extension may be granted from (story 324). */
  unrestrictedFrom?: UnrestrictedFrom
  /**
   * False refuses installing and removing here: the dependency belongs in
   * `package.json` and a deploy, so every node has it and it outlives a restart.
   */
  installs?: boolean
  /** A host's own word on where installs happen, said in place of a deploy (story 181). */
  installsElsewhere?: { message: string; url?: string }
  /** What the site takes of a bundle's signature (story 060); anything signed or not, when absent. */
  policy?: ProvenancePolicy
  /** Checks a package directory's signature; `verifyProvenance`, unless a test stands in. */
  verify?: (dir: string) => Promise<ProvenanceResult>
}

export interface InstallOutcome {
  /** How far it reaches, when an install was refused for it or needs a grant (story 324). */
  level?: AccessLevel
  /** What it asks for, folded into the four groups the panel shows. */
  groups?: PermissionGroups
  /** Its extension id, which a config entry is keyed by. */
  id?: string
  ok: boolean
  /**
   * The dependency line the site's `package.json` now holds, so the UI can show
   * exactly what there is to commit: the range as written, and the version that
   * resolved to.
   */
  dependency?: { name: string; range: string; version: string }
  message: string
  /** What happened to the content the bundle carries; absent when it carries none. */
  content?: ContentOutcome
  /**
   * Refused because it asks for permissions the request did not grant, exactly
   * (stories 222, 308): the screen shows them with their reasons, and sends the
   * install again with the grant.
   */
  needsGrant?: boolean
  /** With `needsGrant`: what it asks for, each with its sentence, its reason and its origins. */
  permissions?: {
    permission: string
    allows: string
    reason: string | null
    origins?: string[]
    /** What the install says before it is granted: only back-office code has one (story 320). */
    warning?: string
  }[]
  /** With `needsGrant`: it asks to act for a user, so the grant names whom (story 308). */
  /** It asks for `user.delegate`: it acts for the person using it (story 325). */
  delegates?: boolean
  /**
   * With `needsGrant`: its page templates sit in a site layout, picked here
   * (story 312). `suggested` is the one it names, when the site has it.
   */
  layout?: { key: string; label: string; values: string[]; suggested?: string }
  /** It changed the code the server loads, which runs once the site restarts (story 241). */
  restartPending?: boolean
  /** Where the version checked was built, from its signature (story 060). */
  provenance?: ProvenanceResult
  /** The file an install from a file keeps in the site, to commit: `bundles/acme-crm-1.2.0.tgz` (story 245). */
  file?: string
}

export type PackageInstaller = (
  action: 'add' | 'remove',
  specifier: string,
  siteDir: string,
) => Promise<{ ok: boolean; output: string }>

interface SearchObject {
  package?: {
    name?: string
    version?: string
    description?: string
    publisher?: { username?: string }
    links?: Record<string, string>
  }
}

/** A name npm would accept, so nothing shell-ish or path-ish reaches `bun add`. */
export function isValidPackageName(name: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) && name.length <= 214
}

/**
 * A version or range that cannot be mistaken for another argument.
 *
 * Ranges start with an operator — `^2.1`, `>=1 <2` — so those lead; `-` never
 * does, because `bun add` would read it as a flag. No shell is involved
 * (`Bun.spawn` takes an argv), so the space in a range is harmless.
 */
export function isValidVersion(version: string): boolean {
  return /^[A-Za-z0-9^~>=<*][A-Za-z0-9.^~>=<| *+-]*$/.test(version) && version.length <= 64
}

export interface Marketplace {
  /** Where someone browsing should be sent, when they want more than this list. */
  url(): string
  search(query: string | undefined): Promise<MarketplaceListing[]>
  installed(): Promise<InstalledListing[]>
  install(
    name: string,
    version: string | undefined,
    options?: {
      applyContent?: boolean
      /** The permissions the administrator granted: the bundle's whole list (stories 222, 308). */
      grant?: readonly string[]
      /** Under `user.delegate`, the user a job or an event acts for: whoever grants it (story 325). */
      delegateTo?: string | null
      /** Who is installing, recorded on the grant. */
      by?: string | null
      /** The person installing is an administrator: only one grants the upper levels (story 324). */
      isAdmin?: boolean
    },
  ): Promise<InstallOutcome>
  /** What a version would bring, read from the registry and nothing installed: for a dry run. */
  inspect(
    name: string,
    version?: string,
  ): Promise<
    | {
        ok: true
        server: boolean
        content: boolean
        extensions: boolean
        permissions: string[]
        version: string
        provenance: ProvenanceResult
      }
    | { ok: false; message: string }
  >
  /** A packed bundle on this machine (a `.tgz`), installed as `install` installs one from the registry. */
  installFile(
    file: string,
    options?: {
      applyContent?: boolean
      grant?: readonly string[]
      delegateTo?: string | null
      by?: string | null
      /** The person installing is an administrator: only one grants the upper levels (story 324). */
      isAdmin?: boolean
    },
  ): Promise<InstallOutcome>
  uninstall(name: string): Promise<InstallOutcome>
}

/**
 * The argv an install runs. `add` never runs a package's install scripts,
 * whatever Bun's own list of trusted packages says (story 194).
 */
export function installCommand(action: 'add' | 'remove', specifier: string): string[] {
  return action === 'add'
    ? ['bun', 'add', '--ignore-scripts', specifier]
    : ['bun', action, specifier]
}

/**
 * `bun add` in the site directory: Bun owns resolution and writes the lockfile.
 *
 * The spawn itself can fail rather than the command — an unreadable site
 * directory or a `bun` that is not on the path both throw out of `Bun.spawn` —
 * and that has to come back as a failed install with a reason, not as an
 * exception the route turns into a 500.
 */
export const bunInstaller: PackageInstaller = async (action, specifier, siteDir) => {
  try {
    const proc = Bun.spawn(installCommand(action, specifier), {
      cwd: siteDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { ok: code === 0, output: `${stdout}${stderr}`.trim() }
  } catch (error) {
    return {
      ok: false,
      output: `bun ${action} could not be run in ${siteDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
}

/** The layout setting a version declares, if it has page templates to place (story 312). */
type AskedLayout = { key: string; label: string; suggested?: string }

function layoutAsked(field: { settings?: unknown } | undefined): AskedLayout | undefined {
  const read = readSettings(field?.settings)
  if (!('settings' in read)) return undefined
  const found = Object.entries(read.settings).find(([, setting]) => setting.type === 'layout')
  if (!found) return undefined
  const [key, setting] = found
  return {
    key,
    label: setting.label,
    ...(typeof setting.default === 'string' ? { suggested: setting.default } : {}),
  }
}

export function createMarketplace(options: MarketplaceOptions): Marketplace {
  /** The site's layouts to pick from, the suggestion kept only when the site has it. */
  const layoutChoice = (asked: AskedLayout | undefined): InstallOutcome['layout'] => {
    if (!asked) return undefined
    const values = options.componentsDir ? siteLayouts(options.componentsDir) : []
    const { suggested, ...rest } = asked
    return { ...rest, values, ...(suggested && values.includes(suggested) ? { suggested } : {}) }
  }
  const call = options.fetch ?? fetch
  const install = options.install ?? bunInstaller

  /** The range `package.json` holds for a dependency, as `bun add` wrote it. */
  const rangeFor = async (name: string): Promise<string | undefined> => {
    try {
      const json = (await Bun.file(join(options.siteDir, 'package.json')).json()) as {
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      return json.dependencies?.[name] ?? json.peerDependencies?.[name]
    } catch {
      return undefined
    }
  }
  let cached: { at: number; query: string; listings: MarketplaceListing[] } | undefined

  /**
   * A bundle's file at `bundles/<name>-<version>.tgz`: used in place when it is
   * there already, copied there otherwise. Another file under that name is
   * refused, since one version is one file.
   */
  const keepInSite = (
    file: string,
    declared: { name: string; version: string },
  ): { path: string; copied: boolean } | string => {
    const path = `${LOCAL_BUNDLES_DIR}/${localBundleFileName(declared.name, declared.version)}`
    const target = join(options.siteDir, path)
    if (resolve(file) === resolve(target)) return { path, copied: false }
    const bytes = readFileSync(file)
    if (existsSync(target)) {
      if (readFileSync(target).equals(bytes)) return { path, copied: false }
      return `${path} already holds a different ${declared.name}@${declared.version} than ${file}, so it was not installed: one version is one file. Remove ${path} first if ${file} is the one to keep.`
    }
    mkdirSync(join(options.siteDir, LOCAL_BUNDLES_DIR), { recursive: true })
    copyFileSync(file, target)
    return { path, copied: true }
  }

  /** The `bundles/` file a dependency used to name, removed once nothing names it. */
  const removeUnnamed = (previousRange: string | undefined, keep?: string) => {
    const path = localBundlePath(previousRange)
    if (!path || path === keep) return
    if (localBundlesNamed(options.siteDir).includes(path)) return
    rmSync(join(options.siteDir, path), { force: true })
  }

  const installedVersion = (name: string): string | null =>
    options.extensions.bundles().bundles.find((bundle) => bundle.packageName === name)?.version ??
    null

  /**
   * What the registry says a version carries: the version asked for (an exact
   * one, or the highest a range admits), or the latest. `not-a-bundle` when that
   * version is no valid bundle, `unreachable` when the registry could not say.
   */
  const declaresAt = async (
    name: string,
    wanted?: string,
  ): Promise<
    | (BundlePackage['carries'] & {
        permissions: DeclaredPermission[]
        layout?: AskedLayout
        version: string
        dist?: Dist
        id?: string
        screens?: number
      })
    | 'not-a-bundle'
    | { refused: string[] }
    | 'site-package'
    | 'schema-3'
    | 'unreachable'
  > => {
    try {
      const response = await call(`${options.registry}/${encodeURIComponent(name)}`, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return response.status === 404 ? 'not-a-bundle' : 'unreachable'
      const packument = (await response.json()) as {
        'dist-tags'?: Record<string, string>
        versions?: Record<string, PackageJson>
      }
      const versions = packument.versions ?? {}
      const resolved =
        wanted === undefined
          ? packument['dist-tags']?.latest
          : wanted in versions
            ? wanted
            : (packument['dist-tags']?.[wanted] ??
              Object.keys(versions)
                .filter((v) => Bun.semver.satisfies(v, wanted))
                .sort(Bun.semver.order)
                .at(-1))
      const version = resolved ? versions[resolved] : undefined
      // A site package is never installed, whatever a registry offers (story 306).
      if ((version?.crombolo as { bundleType?: unknown } | undefined)?.bundleType === 'site')
        return 'site-package'
      if (!resolved || !version) return 'not-a-bundle'
      // Why it is not one, so its author knows what to change: a layout before 0.59 among them (story 320).
      const problems = validateBundlePackage(version)
      if (problems.length > 0) return { refused: problems }
      const dist = (version as { dist?: Dist }).dist
      const field = version.crombolo as {
        extensions?: unknown[]
        content?: boolean
        id?: string
        server?: string
        permissions?: unknown
        settings?: unknown
      }
      // Story 308: a version that says nothing of why it asks is not installed.
      if (isSchema3Field(field)) return 'schema-3'
      return {
        extensions: Array.isArray(field.extensions) && field.extensions.length > 0,
        content: field.content === true,
        server: field.server !== undefined,
        permissions: askedPermissions(field),
        layout: layoutAsked(field),
        version: resolved,
        ...(typeof field.id === 'string' ? { id: field.id } : {}),
        screens: screensOf(field),
        ...(dist ? { dist } : {}),
      }
    } catch {
      return 'unreachable'
    }
  }

  const verify = options.verify ?? ((dir: string) => verifyProvenance(dir))

  /**
   * Where a registry version was built (story 060): its exact tarball fetched,
   * held to the registry's integrity, and its signature checked, so the bytes
   * checked are the bytes `bun add` then installs. A registry that gives no
   * tarball leaves nothing to check; one that cannot be fetched is not unsigned.
   */
  const provenanceAt = async (name: string, dist: Dist | undefined): Promise<ProvenanceResult> => {
    if (!dist?.tarball) return { state: 'unsigned' }
    const dir = mkdtempSync(join(tmpdir(), 'crombolo-bundle-check-'))
    try {
      const response = await call(dist.tarball)
      if (!response.ok)
        return {
          state: 'unchecked',
          reason: `${name} could not be fetched to check its signature (the registry answered ${response.status})`,
        }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (dist.integrity?.startsWith('sha512-')) {
        const got = `sha512-${new Bun.CryptoHasher('sha512').update(bytes).digest('base64')}`
        if (got !== dist.integrity)
          return { state: 'invalid', reason: `${name} is not the package the registry describes` }
      }
      const file = join(dir, 'bundle.tgz')
      await Bun.write(file, bytes)
      const unpacked = join(dir, 'package')
      await extractTarball(file, unpacked)
      return await verify(unpacked)
    } catch (error) {
      return {
        state: 'unchecked',
        reason: `${name} could not be checked: ${error instanceof Error ? error.message : String(error)}`,
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** Why the site's policy refuses a version, as an outcome, or undefined when it may be installed. */
  const refusedBySignature = (
    label: string,
    provenance: ProvenanceResult,
  ): InstallOutcome | undefined => {
    const problem = provenanceProblem(
      provenance,
      options.policy ?? { signatures: 'optional', sources: [] },
    )
    return problem
      ? { ok: false, message: `${label} was not installed: ${problem}.`, provenance }
      : undefined
  }

  /** Why the person may not grant what it asks for here: its level, by who they are and its signature (story 324). */
  const levelRefused = (
    name: string,
    asked: readonly DeclaredPermission[],
    provenance: ProvenanceResult,
    request: { isAdmin?: boolean; grant?: readonly string[] },
  ): InstallOutcome | undefined => {
    const level = levelOf(asked.map((entry) => entry.permission))
    const why = grantRefusal({
      level,
      grants: asked.length > 0,
      isAdmin: request.isAdmin === true,
      provenance,
      from: options.unrestrictedFrom ?? 'backoffice',
    })
    return why
      ? { ok: false, level, message: `${name} was not installed: ${why}`, provenance }
      : undefined
  }

  /** Each installed version's signature, checked once: a version's files do not change. */
  const installedProvenance = new Map<string, Promise<ProvenanceResult>>()
  const provenanceOfInstalled = async (bundle: BundlePackage): Promise<ProvenanceResult> => {
    const range = await rangeFor(bundle.packageName)
    if (range && /^(workspace|link|file|portal):/.test(range)) return { state: 'local' }
    const key = `${bundle.packageName}@${bundle.version}`
    let found = installedProvenance.get(key)
    if (!found) {
      found = verify(bundle.directory).catch((error: unknown) => ({
        state: 'unchecked' as const,
        reason: error instanceof Error ? error.message : String(error),
      }))
      installedProvenance.set(key, found)
    }
    const result = await found
    // Not kept: the next look may be able to check it.
    if (result.state === 'unchecked') installedProvenance.delete(key)
    return result
  }

  /** What the registry says this package's latest version carries, when it is a valid bundle. */
  const declares = async (name: string): Promise<BundlePackage['carries'] | undefined> => {
    const declared = await declaresAt(name)
    if (typeof declared === 'string' || 'refused' in declared) return undefined
    const {
      permissions: _,
      version: _version,
      dist: _dist,
      id: _id,
      screens: _screens,
      ...carries
    } = declared
    return carries
  }

  /** A bundle's permissions, who approved them, and whether it is disabled, for the listing. */
  const grantOf = (bundle: BundlePackage) => ({
    // Story 308: one written before permissions said why runs, flagged.
    schema3: isSchema3(bundle),
    ...grantStateOf(bundle),
  })
  const grantStateOf = (bundle: BundlePackage) => ({
    ...grantRows(bundle),
    // How far it reaches, and what it reached when granted, for Installed's badge (story 324).
    level: levelOf(declaredEntries(bundle).map((entry) => entry.permission)),
    groups: groupsOf(declaredEntries(bundle), { screens: screensOf(bundle.field) }),
    ...(options.grants?.state(bundle).grant?.recorded
      ? { grantedLevel: levelOf(options.grants.state(bundle).grant?.permissions ?? []) }
      : {}),
  })
  const grantRows = (bundle: BundlePackage) => {
    const declared = describePermissions(declaredEntries(bundle))
    if (!options.grants)
      return { permissions: declared, on: true, status: 'on', missing: [], disabledBy: null }
    // Story 309: every extension runs on its grant, screens-only ones included.
    const state = options.grants.state(bundle)
    return {
      permissions: state.declared,
      on: state.on,
      status: state.status,
      missing: state.missing,
      delegates: declaredEntries(bundle).some((entry) => entry.permission === USER_DELEGATE),
      disabledBy: state.disabledBy,
      ...(state.grant?.grantedBy
        ? {
            granted: {
              by: state.grant.grantedBy,
              at: state.grant.grantedAt.toISOString(),
              version: state.grant.version,
            },
          }
        : {}),
    }
  }

  return {
    url: () => options.marketplaceUrl,

    async search(query) {
      // Extensions published before 0.57 carry the old keyword, and are found too.
      const keywords = [...new Set([options.keyword, LEGACY_EXTENSION_KEYWORD])]
      const text = [`keywords:${keywords.join(',')}`, query?.trim()].filter(Boolean).join(' ')
      if (cached && cached.query === text && Date.now() - cached.at < CACHE_MS)
        return cached.listings.map((listing) => ({
          ...listing,
          installedVersion: installedVersion(listing.name),
        }))

      let objects: SearchObject[] = []
      try {
        const response = await call(
          `${options.registry}/-/v1/search?text=${encodeURIComponent(text)}&size=50`,
          { headers: { accept: 'application/json' } },
        )
        if (!response.ok) throw new Error(`the registry answered ${response.status}`)
        objects = ((await response.json()) as { objects?: SearchObject[] }).objects ?? []
      } catch (error) {
        // An unreachable registry is an empty list with a log line, not a 500:
        // an air-gapped site should still be able to open the section.
        log.warning('The package registry could not be reached: {detail}', {
          detail: error instanceof Error ? error.message : String(error),
        })
        return []
      }

      // The packuments are read together: one request per hit, and a page of
      // hits read one at a time would make the view feel broken.
      const listings = await Promise.all(
        objects
          .map((object) => object.package)
          .filter((pkg): pkg is NonNullable<typeof pkg> =>
            Boolean(pkg?.name && isValidPackageName(pkg.name)),
          )
          .map(async (pkg): Promise<MarketplaceListing | undefined> => {
            const name = pkg.name as string
            const carries = await declares(name)
            if (!carries) return undefined
            return {
              name,
              version: pkg.version ?? '0.0.0',
              description: pkg.description ?? '',
              publisher: pkg.publisher?.username ?? null,
              links: {
                npm: pkg.links?.npm ?? `https://www.npmjs.com/package/${name}`,
                homepage: pkg.links?.homepage ?? null,
                repository: pkg.links?.repository ?? null,
              },
              carries,
              installedVersion: installedVersion(name),
            }
          }),
      )
      // Only what really is a bundle: the keyword is a claim, the manifest is
      // the thing itself.
      const offered = listings.filter((listing): listing is MarketplaceListing => Boolean(listing))
      cached = { at: Date.now(), query: text, listings: offered }
      return offered
    },

    async installed() {
      const wired = new Set(options.wired?.() ?? [])
      return Promise.all(
        options.extensions.bundles().bundles.map(async (bundle) => ({
          packageName: bundle.packageName,
          name: bundle.name,
          id: bundle.id,
          version: bundle.version,
          extensionCount: bundle.field.extensions?.length ?? 0,
          carries: bundle.carries,
          wired: wired.has(bundle.id),
          contentApplied: (await options.contentApplied?.(bundle.packageName)) ?? null,
          description: descriptionOf(bundle.directory),
          publisher: authorOf(bundle.directory),
          peerRange: bundle.peerRange,
          ...grantOf(bundle),
          provenance: await provenanceOfInstalled(bundle),
        })),
      )
    },

    async install(name, version, request = {}) {
      if (options.installs === false) return refusedHere(name, 'add', options.installsElsewhere)
      if (!isValidPackageName(name))
        return { ok: false, message: `'${name}' is not a package name npm would accept.` }
      if (version !== undefined && !isValidVersion(version))
        return { ok: false, message: `'${version}' is not a version npm would accept.` }

      // What the version being installed carries, read before anything is
      // installed: server code needs an explicit yes (story 194), and only a
      // bundle is installed here at all.
      const declared = await declaresAt(name, version)
      if (declared === 'unreachable')
        return {
          ok: false,
          message: `The package registry could not say what ${name} contains, so it was not installed. Try again in a moment.`,
        }
      if (declared === 'not-a-bundle')
        return {
          ok: false,
          message: `${name} is not an extension for this site, so it was not installed.`,
        }
      if (declared === 'site-package') return sitePackageRefused(name)
      if (declared === 'schema-3') return schema3Refused(name)
      if ('refused' in declared)
        return {
          ok: false,
          message: `${name} is not an extension this site takes, so it was not installed: ${declared.refused.join('; ')}.`,
        }
      if (!consented(request, declared.permissions))
        return grantNeeded(name, declared.permissions, '', layoutChoice(declared.layout), {
          id: declared.id,
          screens: declared.screens,
        })
      const provenance = await provenanceAt(name, declared.dist)
      const refused = refusedBySignature(`${name}@${declared.version}`, provenance)
      if (refused) return refused
      const beyond = levelRefused(name, declared.permissions, provenance, request)
      if (beyond) return beyond
      // Pinned to the version whose tarball was checked, when one was.
      const outcome = await added(
        name,
        version ? `${name}@${version}` : name,
        version,
        request,
        declared.dist?.tarball ? { version: declared.version } : undefined,
      )
      return { ...outcome, provenance }
    },

    async inspect(name, version) {
      if (!isValidPackageName(name))
        return { ok: false, message: `'${name}' is not a package name npm would accept.` }
      const declared = await declaresAt(name, version)
      if (declared === 'unreachable')
        return { ok: false, message: `The package registry could not say what ${name} contains.` }
      if (declared === 'not-a-bundle')
        return { ok: false, message: `${name} is not an extension for this site.` }
      if (declared === 'site-package') return sitePackageRefused(name)
      if (declared === 'schema-3') return schema3Refused(name)
      if ('refused' in declared)
        return {
          ok: false,
          message: `${name} is not an extension this site takes: ${declared.refused.join('; ')}.`,
        }
      const { dist, permissions, ...carries } = declared
      return {
        ok: true,
        ...carries,
        permissions: permissions.map((entry) => entry.permission),
        provenance: await provenanceAt(name, dist),
      }
    },

    async installFile(file, request = {}) {
      if (options.installs === false) return refusedHere(file, 'add', options.installsElsewhere)
      const declared = await declaresIn(file)
      if (typeof declared === 'string') return { ok: false, message: declared }
      if (!consented(request, declared.permissions))
        return grantNeeded(declared.name, declared.permissions, '', layoutChoice(declared.layout))
      // Kept in the site's bundles/ (story 245), so it is committed and every
      // node, checkout and CI build installs the same file.
      const kept = keepInSite(file, declared)
      if (typeof kept === 'string') return { ok: false, message: kept }
      const discard = () => {
        if (kept.copied) rmSync(join(options.siteDir, kept.path), { force: true })
      }
      const provenance = await verifyPackage(join(options.siteDir, kept.path)).catch(
        (error: unknown) => ({
          state: 'unchecked' as const,
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
      const refused =
        refusedBySignature(declared.name, provenance) ??
        levelRefused(declared.name, declared.permissions, provenance, request)
      if (refused) {
        discard()
        return refused
      }
      const previous = await rangeFor(declared.name)
      const outcome = await added(declared.name, `./${kept.path}`, undefined, request)
      if (!outcome.ok) {
        discard()
        return { ...outcome, provenance }
      }
      removeUnnamed(previous, kept.path)
      return {
        ...outcome,
        provenance,
        file: kept.path,
        message: `${outcome.message} Commit ${kept.path} with package.json and bun.lock.`,
      }
    },

    async uninstall(name) {
      if (options.installs === false) return refusedHere(name, 'remove', options.installsElsewhere)
      if (!isValidPackageName(name))
        return { ok: false, message: `'${name}' is not a package name npm would accept.` }
      const previous = await rangeFor(name)
      const result = await install('remove', name, options.siteDir)
      options.extensions.invalidate()
      if (result.ok) removeUnnamed(previous)
      return result.ok
        ? {
            ok: true,
            message: `${name} was removed. Commit the changed package.json and bun.lock.`,
          }
        : { ok: false, message: result.output || `Removing ${name} failed.` }
    },
  }

  /** `bun add`, then the checks on what landed, the grant, and the content half. */
  async function added(
    name: string,
    specifier: string,
    version: string | undefined,
    request: {
      applyContent?: boolean
      grant?: readonly string[]
      delegateTo?: string | null
      by?: string | null
      /** The person installing is an administrator: only one grants the upper levels (story 324). */
      isAdmin?: boolean
    },
    checked?: { version: string },
  ): Promise<InstallOutcome> {
    const result = await install('add', specifier, options.siteDir)
    options.extensions.invalidate()
    if (!result.ok)
      return {
        ok: false,
        message: result.output || `Installing ${specifier} failed.`,
      }

    const range = (await rangeFor(name)) ?? version ?? 'latest'
    const discovered = options.extensions.bundles()
    const found = discovered.bundles.find((bundle) => bundle.packageName === name)
    // The version that landed may turn out to be a site package: never kept (story 306).
    if (
      discovered.problems.some(
        (problem) =>
          problem.packageName === name && problem.problems.includes(SITE_PACKAGE_NOT_INSTALLED),
      )
    ) {
      await install('remove', name, options.siteDir)
      options.extensions.invalidate()
      return sitePackageRefused(name)
    }
    if (!found)
      return {
        ok: true,
        dependency: { name, range, version: version ?? range },
        message: `${name} was installed, but it is not a valid extension, so nothing was added to the back office.`,
      }
    // The version whose signature was checked is the one that has to land
    // (story 060): one published in between was never checked.
    if (checked && found.version !== checked.version) {
      await install('remove', name, options.siteDir)
      options.extensions.invalidate()
      return {
        ok: false,
        message: `${name}@${found.version} was published while ${checked.version} was being checked, so it was removed again. Try the install again.`,
      }
    }
    // The version that landed is what counts: a release published between
    // reading the registry and installing may ask for more, or say nothing of why.
    if (isSchema3(found)) {
      await install('remove', name, options.siteDir)
      options.extensions.invalidate()
      return schema3Refused(name, `${name}@${found.version} turned out to`)
    }
    if (!consented(request, declaredEntries(found))) {
      await install('remove', name, options.siteDir)
      options.extensions.invalidate()
      return grantNeeded(
        name,
        declaredEntries(found),
        `${name}@${found.version} turned out to ask for more than was granted, so it was removed again.`,
        layoutChoice(layoutAsked(found.field)),
      )
    }
    // What was granted is recorded against the version that landed, for every
    // extension: a grant is what lets one run (story 309).
    const delegates = declaredPermissions(found).includes(USER_DELEGATE)
    if (delegates && !request.delegateTo) {
      await install('remove', name, options.siteDir)
      options.extensions.invalidate()
      return { ok: false, message: `${name} was not installed: ${DELEGATE_NEEDS_PERSON}.` }
    }
    await options.grants?.grant(found, request.by ?? null, {
      delegateKey: delegates ? request.delegateTo : null,
    })

    // The content half lands after the dependency, so a refused check leaves
    // the package installed and says why, rather than undoing an install that
    // succeeded.
    let content: ContentOutcome | undefined
    if (found.carries.content) {
      const declined = request.applyContent === false || options.applyContentOnInstall === false
      content =
        declined || !options.applyContent
          ? {
              applied: false,
              message: `Its content was not applied. Run \`crombolo extension install ${name}\` to apply it.`,
            }
          : await options.applyContent(name).catch((error: unknown) => ({
              applied: false,
              message: `Its content could not be applied: ${error instanceof Error ? error.message : String(error)}`,
            }))
    }
    return {
      ok: true,
      dependency: { name, range, version: found.version },
      // The install lives in this node's node_modules until the dependency is
      // committed; saying so is the difference between a surprise and a plan.
      message: `${name}@${found.version} is installed. Commit the changed package.json and bun.lock to keep it across deployments.${
        found.carries.server
          ? " Its server code runs only once your site's developers turn it on and deploy the site."
          : ''
      }${found.carries.extensions ? ` ${SCREENS_NOTICE}` : ''}`,
      ...(content ? { content } : {}),
    }
  }
}

/** A site package offered as a dependency: refused, saying how one is used (story 306). */
function sitePackageRefused(name: string): { ok: false; message: string } {
  return {
    ok: false,
    message: `${name} is a site package, which is applied to a site with \`crombolo site apply\`, never installed, so it was not installed.`,
  }
}

/** What a packed bundle on this machine declares, read from its package.json, or why it cannot be installed. */
async function declaresIn(file: string): Promise<
  | {
      name: string
      version: string
      server: boolean
      permissions: DeclaredPermission[]
      layout?: AskedLayout
    }
  | string
> {
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-bundle-file-'))
  try {
    await extractTarball(file, dir)
    const root = existsSync(join(dir, 'package', 'package.json')) ? join(dir, 'package') : dir
    const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson
    if ((json.crombolo as { bundleType?: unknown } | undefined)?.bundleType === 'site')
      return sitePackageRefused(file).message
    const problems = validateBundlePackage(json)
    if (problems.length > 0 || typeof json.name !== 'string' || typeof json.version !== 'string')
      return `${file} is not an extension for this site, so it was not installed.`
    const field = json.crombolo as { server?: string; permissions?: unknown; settings?: unknown }
    if (isSchema3Field(field)) return `${file} was not installed: ${SCHEMA_3_NOT_INSTALLED}.`
    return {
      name: json.name,
      version: json.version,
      server: field.server !== undefined,
      permissions: askedPermissions(field),
      layout: layoutAsked(field),
    }
  } catch {
    return `${file} could not be read as a packed bundle, so it was not installed.`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A package's own description, read leniently: anything unreadable is none. */
/** Who made an installed package, as its `author` says: npm's publisher is not kept with it. */
function authorOf(directory: string): string | null {
  try {
    const json = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      author?: unknown
    }
    const author = json.author
    if (typeof author === 'string') return author.replace(/\s*[<(].*$/, '').trim() || null
    if (
      author &&
      typeof author === 'object' &&
      typeof (author as { name?: unknown }).name === 'string'
    )
      return (author as { name: string }).name
    return null
  } catch {
    return null
  }
}

function descriptionOf(directory: string): string {
  try {
    const json = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      description?: unknown
    }
    return typeof json.description === 'string' ? json.description : ''
  } catch {
    return ''
  }
}

/** Said of every bundle installed here: its screens are someone else's code in our browsers. */
export const SCREENS_NOTICE = 'Its screens run in the browser of everyone who uses the back office.'

/**
 * Whether an install request granted exactly what the extension asks for
 * (stories 222, 308): all of it, nothing it did not ask, and whom it acts for
 * One that asks for nothing needs no grant.
 */
function consented(
  request: { grant?: readonly string[] },
  asked: readonly DeclaredPermission[],
): boolean {
  const permissions = asked.map((entry) => entry.permission)
  if (permissions.length === 0) return true
  const granted = new Set(request.grant ?? [])
  return granted.size === new Set(permissions).size && permissions.every((p) => granted.has(p))
}

/** How many screens its manifest's entries name (story 323), for what it adds. */
const screensOf = (field: { extensions?: unknown }): number =>
  Array.isArray(field.extensions)
    ? field.extensions.filter(
        (entry) => entry && typeof entry === 'object' && 'screen' in (entry as object),
      ).length
    : 0

/** A refusal the screen answers by showing what it asks for, with the reasons, and the grant. */
function grantNeeded(
  name: string,
  asked: readonly DeclaredPermission[],
  before = '',
  layout?: InstallOutcome['layout'],
  about: { id?: string; screens?: number } = {},
): InstallOutcome {
  return {
    ok: false,
    needsGrant: true,
    permissions: describePermissions(asked),
    level: levelOf(asked.map((entry) => entry.permission)),
    groups: groupsOf(asked, { screens: about.screens }),
    ...(about.id ? { id: about.id } : {}),
    delegates: asked.some((entry) => entry.permission === USER_DELEGATE),
    ...(layout ? { layout } : {}),
    message: `${before ? `${before} ` : ''}${name} asks for these permissions. Grant them, each as it asks, to install it.`,
  }
}

/** A version written before permissions said why (story 308). */
function schema3Refused(
  name: string,
  before = `${name} was not installed:`,
): { ok: false; message: string } {
  return { ok: false, message: `${before} ${SCHEMA_3_NOT_INSTALLED}.` }
}

/** What a site that does not install at runtime says instead, with what to do. */
function refusedHere(
  name: string,
  verb: 'add' | 'remove',
  elsewhere?: { message: string; url?: string },
): InstallOutcome {
  if (elsewhere)
    return {
      ok: false,
      message: elsewhere.url ? `${elsewhere.message} ${elsewhere.url}` : elsewhere.message,
    }
  return {
    ok: false,
    message:
      verb === 'add'
        ? `Packages are not installed from the backoffice on this site. Add ${name} to the site's package.json (bun add ${name}) and deploy, so every server has it.`
        : `Packages are not removed from the backoffice on this site. Remove ${name} from the site's package.json (bun remove ${name}) and deploy.`,
  }
}

export { EXTENSION_KEYWORD }
