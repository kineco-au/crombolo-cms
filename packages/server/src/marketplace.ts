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
 * `crombolo bundle install`. A bundle's server half is never loaded by an
 * install: that still takes an edit to `crombolo.config.ts` and a deploy.
 *
 * The search is proxied rather than done in the browser: it works where the
 * browser cannot reach npm, and the backoffice keeps making same-origin
 * requests only.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BundlePackage,
  describePermissions,
  EXTENSION_KEYWORD,
  type ExtensionRegistry,
  type PackageJson,
  validateBundlePackage,
} from '@crombolo/backoffice-host'
import { type BundleGrants, declaredPermissions } from './bundle-grants.ts'
import { logger } from './logging.ts'

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
  /**
   * False refuses installing and removing here: the dependency belongs in
   * `package.json` and a deploy, so every node has it and it outlives a restart.
   */
  installs?: boolean
  /** A host's own word on where installs happen, said in place of a deploy (story 181). */
  installsElsewhere?: { message: string; url?: string }
}

export interface InstallOutcome {
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
   * Refused because the bundle runs code on the server and the request did not
   * accept that (story 194): the screen asks, and sends the install again.
   */
  needsServerConsent?: boolean
  /** With `needsServerConsent`: what it asks to do with the site, to grant as a whole (story 222). */
  permissions?: { permission: string; allows: string }[]
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
      acceptServerCode?: boolean
      /** The permissions the administrator granted: the bundle's whole list (story 222). */
      grant?: readonly string[]
      /** Who is installing, recorded on the grant. */
      by?: string | null
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

export function createMarketplace(options: MarketplaceOptions): Marketplace {
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
    (BundlePackage['carries'] & { permissions: string[] }) | 'not-a-bundle' | 'unreachable'
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
      if (!version || validateBundlePackage(version).length > 0) return 'not-a-bundle'
      const field = version.crombolo as {
        extensions?: unknown[]
        content?: boolean
        server?: string
        permissions?: string[]
      }
      return {
        extensions: Array.isArray(field.extensions) && field.extensions.length > 0,
        content: field.content === true,
        server: field.server !== undefined,
        permissions: Array.isArray(field.permissions) ? field.permissions : [],
      }
    } catch {
      return 'unreachable'
    }
  }

  /** What the registry says this package's latest version carries, when it is a valid bundle. */
  const declares = async (name: string): Promise<BundlePackage['carries'] | undefined> => {
    const declared = await declaresAt(name)
    if (typeof declared === 'string') return undefined
    const { permissions: _, ...carries } = declared
    return carries
  }

  /** A bundle's permissions, who approved them, and whether it is disabled, for the listing. */
  const grantOf = (bundle: BundlePackage) => {
    const declared = describePermissions(declaredPermissions(bundle))
    if (!bundle.carries.server || !options.grants)
      return { permissions: declared, on: true, disabledBy: null }
    const state = options.grants.state(bundle)
    return {
      permissions: state.declared,
      on: state.on,
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
      const text = [`keywords:${options.keyword}`, query?.trim()].filter(Boolean).join(' ')
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
          peerRange: bundle.peerRange,
          ...grantOf(bundle),
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
          message: `${name} is not a bundle for this site, so it was not installed.`,
        }
      if (declared.server && !consented(request, declared.permissions))
        return serverConsentNeeded(name, declared.permissions)

      const specifier = version ? `${name}@${version}` : name
      const result = await install('add', specifier, options.siteDir)
      options.extensions.invalidate()
      if (!result.ok)
        return {
          ok: false,
          message: result.output || `Installing ${specifier} failed.`,
        }

      const range = (await rangeFor(name)) ?? version ?? 'latest'
      const found = options.extensions
        .bundles()
        .bundles.find((bundle) => bundle.packageName === name)
      if (!found)
        return {
          ok: true,
          dependency: { name, range, version: version ?? range },
          message: `${name} was installed, but it is not a valid bundle, so nothing was added to the backoffice.`,
        }
      // The version that landed is what counts: a release published between
      // reading the registry and installing may have brought server code.
      if (found.carries.server && !consented(request, declaredPermissions(found))) {
        await install('remove', name, options.siteDir)
        options.extensions.invalidate()
        return serverConsentNeeded(
          name,
          declaredPermissions(found),
          `${name}@${found.version} turned out to run code on the server, or to ask for more than was granted, so it was removed again.`,
        )
      }
      // What was granted is recorded against the version that landed.
      if (found.carries.server) await options.grants?.grant(found, request.by ?? null)

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
                message: `Its content was not applied. Run \`crombolo bundle install ${name}\` to apply it.`,
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
    },

    async uninstall(name) {
      if (options.installs === false) return refusedHere(name, 'remove', options.installsElsewhere)
      if (!isValidPackageName(name))
        return { ok: false, message: `'${name}' is not a package name npm would accept.` }
      const result = await install('remove', name, options.siteDir)
      options.extensions.invalidate()
      return result.ok
        ? {
            ok: true,
            message: `${name} was removed. Commit the changed package.json and bun.lock.`,
          }
        : { ok: false, message: result.output || `Removing ${name} failed.` }
    },
  }
}

/** A package's own description, read leniently: anything unreadable is none. */
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
 * Whether an install request said yes to server code and granted exactly what
 * the bundle asks for (stories 194, 222): all of it, and nothing it did not ask.
 */
function consented(
  request: { acceptServerCode?: boolean; grant?: readonly string[] },
  permissions: readonly string[],
): boolean {
  if (request.acceptServerCode !== true) return false
  const granted = new Set(request.grant ?? [])
  return granted.size === new Set(permissions).size && permissions.every((p) => granted.has(p))
}

/** A refusal the screen answers by asking for an explicit yes, and the grant (stories 194, 222). */
function serverConsentNeeded(
  name: string,
  permissions: readonly string[],
  before = '',
): InstallOutcome {
  return {
    ok: false,
    needsServerConsent: true,
    permissions: describePermissions(permissions),
    message: `${before ? `${before} ` : ''}${name} runs code on the server, with access to the site's data, files and settings. Confirm that you trust its publisher, and approve what it asks to do, to install it.`,
  }
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
