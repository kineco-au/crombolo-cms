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
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AccessLevel,
  type BundlePackage,
  type DeclaredPermission,
  describePermissions,
  EXTENSION_KEYWORD,
  type ExtensionRegistry,
  forgetExtension,
  groupsOf,
  LEGACY_EXTENSION_KEYWORD,
  levelOf,
  type PermissionGroups,
  RECORD_FILE,
  ROOTS_DIR,
  readPackageJson,
  readRecord,
  rootOf,
  SCHEMA_3_NOT_INSTALLED,
  SITE_PACKAGE_NOT_INSTALLED,
  USER_DELEGATE,
} from '@crombolo/backoffice-host'
import { localBundlePath, localBundlesNamed } from '@crombolo/transfer'
import {
  type BundleGrants,
  DELEGATE_NEEDS_PERSON,
  declaredEntries,
  declaredPermissions,
  isSchema3,
} from './bundle-grants.ts'
import { siteLayouts } from './components.ts'
import {
  type AskedLayout,
  bunInstaller,
  declaresAt as declaresAtRegistry,
  declaresIn,
  installIntoRoot,
  isValidPackageName,
  isValidVersion,
  keepInSite,
  layoutAsked,
  type PackageInstaller,
  provenanceAt as provenanceAtRegistry,
  screensOf,
  signatureRefusal,
  sitePackageRefused,
} from './extension-install.ts'
import { grantRefusal, type UnrestrictedFrom } from './grant-policy.ts'
import { logger } from './logging.ts'
import {
  type ProvenancePolicy,
  type ProvenanceResult,
  verifyPackage,
  verifyProvenance,
} from './provenance.ts'

export {
  bunInstaller,
  installCommand,
  isValidPackageName,
  isValidVersion,
  type PackageInstaller,
} from './extension-install.ts'

const log = logger('packages')

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

interface SearchObject {
  package?: {
    name?: string
    version?: string
    description?: string
    publisher?: { username?: string }
    links?: Record<string, string>
  }
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
    // Story 326: an extension's range is in its own root's package.json, when it names one.
    const recorded = Object.entries(readRecord(options.siteDir)).find(
      ([, line]) => line.name === name,
    )
    const inRoot = recorded
      ? readPackageJson(join(rootOf(options.siteDir, recorded[0]), 'package.json'))?.dependencies?.[
          name
        ]
      : undefined
    if (inRoot) return inRoot
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

  const declaresAt = (name: string, wanted?: string) =>
    declaresAtRegistry(options.registry, name, wanted, call)
  const verify = options.verify ?? ((dir: string) => verifyProvenance(dir))
  const provenanceAt = (name: string, dist: Parameters<typeof provenanceAtRegistry>[1]) =>
    provenanceAtRegistry(name, dist, { fetch: call, verify })

  /** Why the site's policy refuses a version, as an outcome, or undefined when it may be installed. */
  const refusedBySignature = (
    label: string,
    provenance: ProvenanceResult,
  ): InstallOutcome | undefined => {
    const message = signatureRefusal(label, provenance, options.policy)
    return message ? { ok: false, message, provenance } : undefined
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
    // Installed from a path or a workspace into its root, as a developer's own is (story 326).
    if (bundle.root && readRecord(options.siteDir)[bundle.id]?.linked) return { state: 'local' }
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
        { id: declared.id ?? name, integrity: declared.dist?.integrity },
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
      const kept = keepInSite(options.siteDir, file, declared)
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
      const outcome = await added(declared.name, `./${kept.path}`, undefined, request, undefined, {
        id: declared.id,
      })
      if (!outcome.ok) {
        discard()
        return { ...outcome, provenance }
      }
      removeUnnamed(previous, kept.path)
      return {
        ...outcome,
        provenance,
        file: kept.path,
        message: `${outcome.message} Commit ${kept.path} with it.`,
      }
    },

    async uninstall(name) {
      if (options.installs === false) return refusedHere(name, 'remove', options.installsElsewhere)
      if (!isValidPackageName(name))
        return { ok: false, message: `'${name}' is not a package name npm would accept.` }
      // Story 326: removing one is deleting its root and its line.
      const recorded = Object.entries(readRecord(options.siteDir)).find(
        ([, line]) => line.name === name,
      )
      if (recorded) {
        const [id] = recorded
        const previous = await rangeFor(name)
        rmSync(rootOf(options.siteDir, id), { recursive: true, force: true })
        forgetExtension(options.siteDir, id)
        options.extensions.invalidate()
        removeUnnamed(previous)
        return {
          ok: true,
          message: `${name} was removed. Commit the removal of ${ROOTS_DIR}/${id}/ and the change to ${RECORD_FILE}.`,
        }
      }
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
    checked: { version: string } | undefined,
    into: { id: string; integrity?: string },
  ): Promise<InstallOutcome> {
    // Story 326: into a root of its own, never the site's dependencies.
    const installed = await installIntoRoot(
      options.siteDir,
      { id: into.id, name, specifier, version, integrity: into.integrity },
      install,
    )
    options.extensions.invalidate()
    if (!installed.ok) return { ok: false, message: installed.message }
    const undo = installed.undo

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
      undo()
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
      undo()
      options.extensions.invalidate()
      return {
        ok: false,
        message: `${name}@${found.version} was published while ${checked.version} was being checked, so it was removed again. Try the install again.`,
      }
    }
    // The version that landed is what counts: a release published between
    // reading the registry and installing may ask for more, or say nothing of why.
    if (isSchema3(found)) {
      undo()
      options.extensions.invalidate()
      return schema3Refused(name, `${name}@${found.version} turned out to`)
    }
    if (!consented(request, declaredEntries(found))) {
      undo()
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
      undo()
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
      message: `${name}@${found.version} is installed. Commit ${ROOTS_DIR}/${into.id}/ and ${RECORD_FILE} to keep it across deployments.${
        found.carries.server
          ? " Its server code runs only once your site's developers turn it on and deploy the site."
          : ''
      }${found.carries.extensions ? ` ${SCREENS_NOTICE}` : ''}`,
      ...(content ? { content } : {}),
    }
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
