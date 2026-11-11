/**
 * Putting an extension into its root (stories 326, 332): what a registry
 * version or a kept file declares, its signature held to a policy, `bun add` in
 * its root, what landed checked against its integrity, and its line in the
 * record. The Marketplace installs through it, and so does `installExtension`,
 * a host's own way to install. docs/bundles.md, "The record and the roots".
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import {
  askedPermissions,
  type BundlePackage,
  type DeclaredPermission,
  forgetExtension,
  isSchema3Field,
  type PackageJson,
  packageInRoot,
  prepareRoot,
  type RecordedExtension,
  readBundlePackage,
  readPackageJson,
  readRecord,
  readSettings,
  recordExtension,
  rootOf,
  SCHEMA_3_NOT_INSTALLED,
  validateBundlePackage,
} from '@crombolo/backoffice-host'
import { LOCAL_BUNDLES_DIR, localBundleFileName } from '@crombolo/transfer'
import { loadConfig } from './config.ts'
import {
  type ProvenancePolicy,
  type ProvenanceResult,
  provenanceProblem,
  verifyPackage,
  verifyProvenance,
} from './provenance.ts'
import { extractTarball } from './tar.ts'

/** Where a registry version's tarball is, and what it hashes to. */
export interface Dist {
  tarball?: string
  integrity?: string
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

export type PackageInstaller = (
  action: 'add' | 'remove',
  specifier: string,
  siteDir: string,
) => Promise<{ ok: boolean; output: string }>

/**
 * The argv an install runs. `add` never runs a package's install scripts,
 * whatever Bun's own list of trusted packages says (story 194).
 */
export function installCommand(
  action: 'add' | 'remove',
  specifier: string,
  registry?: string,
): string[] {
  const from = registry ? ['--registry', registry] : []
  return action === 'add'
    ? ['bun', 'add', '--ignore-scripts', ...from, specifier]
    : ['bun', action, ...from, specifier]
}

/**
 * `bun add` in a directory, from the registry given or Bun's own: Bun owns
 * resolution and writes the lockfile.
 *
 * The spawn itself can fail rather than the command — an unreadable directory
 * or a `bun` that is not on the path both throw out of `Bun.spawn` — and that
 * has to come back as a failed install with a reason, not as an exception.
 */
export function installerFrom(registry?: string): PackageInstaller {
  return async (action, specifier, siteDir) => {
    try {
      const proc = Bun.spawn(installCommand(action, specifier, registry), {
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
}

/** `bun add` from Bun's own registry. */
export const bunInstaller: PackageInstaller = installerFrom()

/** The layout setting a version declares, if it has page templates to place (story 312). */
export type AskedLayout = { key: string; label: string; suggested?: string }

export function layoutAsked(field: { settings?: unknown } | undefined): AskedLayout | undefined {
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

/** How many screens its manifest's entries name (story 323), for what it adds. */
export const screensOf = (field: { extensions?: unknown }): number =>
  Array.isArray(field.extensions)
    ? field.extensions.filter(
        (entry) => entry && typeof entry === 'object' && 'screen' in (entry as object),
      ).length
    : 0

/** What a registry version declares, read from its packument. */
export type RegistryDeclaration = BundlePackage['carries'] & {
  permissions: DeclaredPermission[]
  layout?: AskedLayout
  version: string
  dist?: Dist
  id?: string
  screens?: number
}

/**
 * What the registry says a version carries: the version asked for (an exact
 * one, or the highest a range admits), or the latest. `not-a-bundle` when that
 * version is no valid bundle, `unreachable` when the registry could not say.
 */
export async function declaresAt(
  registry: string,
  name: string,
  wanted?: string,
  call: typeof fetch = fetch,
): Promise<
  | RegistryDeclaration
  | 'not-a-bundle'
  | { refused: string[] }
  | 'site-package'
  | 'schema-3'
  | 'unreachable'
> {
  try {
    const response = await call(`${registry}/${encodeURIComponent(name)}`, {
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

/** A site package offered as a dependency: refused, saying how one is used (story 306). */
export function sitePackageRefused(name: string): { ok: false; message: string } {
  return {
    ok: false,
    message: `${name} is a site package, which is applied to a site with \`crombolo site apply\`, never installed, so it was not installed.`,
  }
}

/** What a packed bundle on this machine declares, read from its package.json. */
export interface FileDeclaration {
  id: string
  name: string
  version: string
  server: boolean
  permissions: DeclaredPermission[]
  layout?: AskedLayout
}

/** What a packed bundle on this machine declares, or why it cannot be installed. */
export async function declaresIn(file: string): Promise<FileDeclaration | string> {
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
    const field = json.crombolo as {
      id: string
      server?: string
      permissions?: unknown
      settings?: unknown
    }
    if (isSchema3Field(field)) return `${file} was not installed: ${SCHEMA_3_NOT_INSTALLED}.`
    return {
      id: field.id,
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

/** A tarball's integrity, as npm writes one. */
export const integrityOf = (bytes: Uint8Array): string =>
  `sha512-${new Bun.CryptoHasher('sha512').update(bytes).digest('base64')}`

/**
 * Where a registry version was built (story 060): its exact tarball fetched,
 * held to the registry's integrity, and its signature checked, so the bytes
 * checked are the bytes `bun add` then installs. A registry that gives no
 * tarball leaves nothing to check; one that cannot be fetched is not unsigned.
 */
export async function provenanceAt(
  name: string,
  dist: Dist | undefined,
  options: { fetch?: typeof fetch; verify?: (dir: string) => Promise<ProvenanceResult> } = {},
): Promise<ProvenanceResult> {
  if (!dist?.tarball) return { state: 'unsigned' }
  const call = options.fetch ?? fetch
  const verify = options.verify ?? ((dir: string) => verifyProvenance(dir))
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-bundle-check-'))
  try {
    const response = await call(dist.tarball)
    if (!response.ok)
      return {
        state: 'unchecked',
        reason: `${name} could not be fetched to check its signature (the registry answered ${response.status})`,
      }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (dist.integrity?.startsWith('sha512-') && integrityOf(bytes) !== dist.integrity)
      return { state: 'invalid', reason: `${name} is not the package the registry describes` }
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

/** Why a policy refuses a version, or undefined when it may be installed. Pure. */
export function signatureRefusal(
  label: string,
  provenance: ProvenanceResult,
  policy: ProvenancePolicy = { signatures: 'optional', sources: [] },
): string | undefined {
  const problem = provenanceProblem(provenance, policy)
  return problem ? `${label} was not installed: ${problem}.` : undefined
}

/**
 * A bundle's file at `bundles/<name>-<version>.tgz` (story 245): used in place
 * when it is there already, copied there otherwise. Another file under that
 * name is refused, since one version is one file.
 */
export function keepInSite(
  siteDir: string,
  file: string,
  declared: { name: string; version: string },
): { path: string; copied: boolean } | string {
  const path = `${LOCAL_BUNDLES_DIR}/${localBundleFileName(declared.name, declared.version)}`
  const target = join(siteDir, path)
  if (resolve(file) === resolve(target)) return { path, copied: false }
  const bytes = readFileSync(file)
  if (existsSync(target)) {
    if (readFileSync(target).equals(bytes)) return { path, copied: false }
    return `${path} already holds a different ${declared.name}@${declared.version} than ${file}, so it was not installed: one version is one file. Remove ${path} first if ${file} is the one to keep.`
  }
  mkdirSync(join(siteDir, LOCAL_BUNDLES_DIR), { recursive: true })
  copyFileSync(file, target)
  return { path, copied: true }
}

/**
 * The integrity a root's `bun.lock` holds for a package, or undefined when it
 * holds none. The lockfile is JSON with trailing commas.
 */
export function lockedIntegrity(root: string, name: string): string | undefined {
  try {
    const text = readFileSync(join(root, 'bun.lock'), 'utf8').replace(/,(\s*[}\]])/g, '$1')
    const entry = (JSON.parse(text) as { packages?: Record<string, unknown> }).packages?.[name]
    return Array.isArray(entry)
      ? entry.find((part): part is string => typeof part === 'string' && /^sha\d+-/.test(part))
      : undefined
  } catch {
    return undefined
  }
}

/** An install into a root that landed, with the line it recorded and how to take it out again. */
export interface RootInstall {
  ok: true
  root: string
  line: RecordedExtension
  undo: () => void
}

/**
 * `bun add` into the extension's own root (story 326), never the site's
 * dependencies, then the line in the record. A `./` specifier is a site path,
 * read from the root. What landed is held to the integrity given, by the
 * root's lockfile; on a failure a root made here is taken out again.
 */
export async function installIntoRoot(
  siteDir: string,
  into: { id: string; name: string; specifier: string; version?: string; integrity?: string },
  install: PackageInstaller,
): Promise<RootInstall | { ok: false; message: string }> {
  const existed = existsSync(rootOf(siteDir, into.id))
  const root = prepareRoot(siteDir, into.id)
  const undo = () => {
    rmSync(root, { recursive: true, force: true })
    forgetExtension(siteDir, into.id)
  }
  const inRoot = into.specifier.startsWith('./')
    ? `file:${relative(root, join(siteDir, into.specifier)).split(sep).join('/')}`
    : into.specifier
  const result = await install('add', inRoot, root)
  if (!result.ok) {
    if (!existed) undo()
    return { ok: false, message: result.output || `Installing ${into.specifier} failed.` }
  }
  const locked = lockedIntegrity(root, into.name)
  if (into.integrity && locked && locked !== into.integrity) {
    undo()
    return {
      ok: false,
      message: `${into.name} installed as ${locked}, not the ${into.integrity} it was to be, so it was removed again.`,
    }
  }
  const landed = readPackageJson(join(packageInRoot(siteDir, into.id, into.name), 'package.json'))
  const line: RecordedExtension = {
    name: into.name,
    version: landed?.version ?? into.version ?? 'unknown',
    ...(into.integrity ? { integrity: into.integrity } : {}),
  }
  recordExtension(siteDir, into.id, line)
  return { ok: true, root, line, undo }
}

/** What a host asks `installExtension` for. */
export interface InstallExtensionOptions {
  /** Its npm package name. */
  name: string
  /** A version, a range or a dist-tag; the latest when absent. */
  version?: string
  /** What its tarball must hash to; the registry's is recorded when absent. */
  integrity?: string
  /** A packed `.tgz` to install in place of the registry's, kept in the site's `bundles/`. */
  file?: string
  /** What the site takes of a signature; the site's `CROMBOLO_BUNDLE_SIGNATURES` and `CROMBOLO_BUNDLE_SOURCES` when absent. */
  policy?: ProvenancePolicy
  /** The registry to install from; the site's `CROMBOLO_NPM_REGISTRY` when absent. */
  registry?: string
}

export type InstallExtensionResult =
  | {
      ok: true
      id: string
      root: string
      line: RecordedExtension
      provenance: ProvenanceResult
    }
  | { ok: false; problems: string[] }

const refused = (...problems: string[]): { ok: false; problems: string[] } => ({
  ok: false,
  problems,
})

/** Why the package that landed in a root is not one the site takes, or undefined. */
function landedProblem(
  siteDir: string,
  id: string,
  name: string,
  expected: string,
): string | undefined {
  const dir = packageInRoot(siteDir, id, name)
  const json = readPackageJson(join(dir, 'package.json'))
  if ((json?.crombolo as { bundleType?: unknown } | undefined)?.bundleType === 'site')
    return sitePackageRefused(name).message
  const read = readBundlePackage(dir)
  if (!read.bundle)
    return `${name} is not an extension this site takes, so it was removed again${read.problems.length > 0 ? `: ${read.problems.join('; ')}` : ''}.`
  if (read.bundle.bundleType !== 'extension' || read.bundle.id !== id)
    return `${name} is not the extension "${id}" it said it was, so it was removed again.`
  if (read.bundle.version !== expected)
    return `${name}@${read.bundle.version} landed where ${expected} was checked, so it was removed again. Try the install again.`
  if (isSchema3Field(read.bundle.field))
    return `${name}@${read.bundle.version} was removed again: ${SCHEMA_3_NOT_INSTALLED}.`
  return undefined
}

/**
 * Installs an extension into its root and records it, as the Marketplace does
 * (story 332): from the registry, or a packed file. It is refused when the
 * site's signature policy, or the one passed, refuses it, and when it is not an
 * extension this release takes. It grants nothing and applies no content.
 */
export async function installExtension(
  siteDir: string,
  options: InstallExtensionOptions,
): Promise<InstallExtensionResult> {
  const { name } = options
  if (!isValidPackageName(name)) return refused(`'${name}' is not a package name npm would accept.`)
  if (options.version !== undefined && !isValidVersion(options.version))
    return refused(`'${options.version}' is not a version npm would accept.`)
  let site: { policy: ProvenancePolicy; registry: string }
  try {
    const config = loadConfig({ siteDir }, siteDir)
    site = { policy: config.bundlePolicy, registry: config.npmRegistry }
  } catch (error) {
    return refused(error instanceof Error ? error.message : String(error))
  }
  const policy = options.policy ?? site.policy
  const registry = (options.registry ?? site.registry).replace(/\/+$/, '')
  return options.file
    ? installFromFile(siteDir, options, options.file, policy, registry)
    : installFromRegistry(siteDir, options, policy, registry)
}

async function installFromRegistry(
  siteDir: string,
  options: InstallExtensionOptions,
  policy: ProvenancePolicy,
  registry: string,
): Promise<InstallExtensionResult> {
  const { name } = options
  const declared = await declaresAt(registry, name, options.version)
  if (declared === 'unreachable')
    return refused(
      `The package registry could not say what ${name} contains, so it was not installed.`,
    )
  if (declared === 'not-a-bundle')
    return refused(`${name} is not an extension for this site, so it was not installed.`)
  if (declared === 'site-package') return refused(sitePackageRefused(name).message)
  if (declared === 'schema-3')
    return refused(`${name} was not installed: ${SCHEMA_3_NOT_INSTALLED}.`)
  if ('refused' in declared)
    return refused(
      `${name} is not an extension this site takes, so it was not installed: ${declared.refused.join('; ')}.`,
    )
  if (!declared.id)
    return refused(`${name} is not an extension for this site, so it was not installed.`)
  const label = `${name}@${declared.version}`
  const integrity = declared.dist?.integrity
  if (options.integrity && options.integrity !== integrity)
    return refused(
      `${label} was not installed: the registry gives its integrity as ${integrity ?? 'nothing'}, not ${options.integrity}.`,
    )
  const provenance = await provenanceAt(name, declared.dist)
  const unsigned = signatureRefusal(label, provenance, policy)
  if (unsigned) return refused(unsigned)
  return landed(siteDir, {
    id: declared.id,
    name,
    specifier: `${name}@${declared.version}`,
    version: declared.version,
    integrity,
    registry,
    provenance,
  })
}

async function installFromFile(
  siteDir: string,
  options: InstallExtensionOptions,
  file: string,
  policy: ProvenancePolicy,
  registry: string,
): Promise<InstallExtensionResult> {
  const declared = await declaresIn(file)
  if (typeof declared === 'string') return refused(declared)
  if (declared.name !== options.name)
    return refused(`${file} holds ${declared.name}, not ${options.name}, so it was not installed.`)
  if (options.version !== undefined && options.version !== declared.version)
    return refused(
      `${file} holds ${declared.name}@${declared.version}, not ${options.version}, so it was not installed.`,
    )
  const integrity = integrityOf(new Uint8Array(readFileSync(file)))
  if (options.integrity && options.integrity !== integrity)
    return refused(
      `${file} was not installed: its integrity is ${integrity}, not ${options.integrity}.`,
    )
  const provenance = await verifyPackage(file).catch((error: unknown) => ({
    state: 'unchecked' as const,
    reason: error instanceof Error ? error.message : String(error),
  }))
  const unsigned = signatureRefusal(declared.name, provenance, policy)
  if (unsigned) return refused(unsigned)
  const kept = keepInSite(siteDir, file, declared)
  if (typeof kept === 'string') return refused(kept)
  const outcome = await landed(siteDir, {
    id: declared.id,
    name: declared.name,
    specifier: `./${kept.path}`,
    version: declared.version,
    integrity,
    registry,
    provenance,
  })
  if (!outcome.ok && kept.copied) rmSync(join(siteDir, kept.path), { force: true })
  return outcome
}

/** The install into the root, and what landed checked; taken out again when it is refused. */
async function landed(
  siteDir: string,
  into: {
    id: string
    name: string
    specifier: string
    version: string
    integrity?: string
    registry: string
    provenance: ProvenanceResult
  },
): Promise<InstallExtensionResult> {
  const result = await installIntoRoot(siteDir, into, installerFrom(into.registry))
  if (!result.ok) return refused(result.message)
  const problem = landedProblem(siteDir, into.id, into.name, into.version)
  if (problem) {
    result.undo()
    return refused(problem)
  }
  return {
    ok: true,
    id: into.id,
    root: result.root,
    line: result.line,
    provenance: into.provenance,
  }
}

/**
 * Deletes an extension's root and its line in the record, and nothing else:
 * its data, grant and settings stay, for the host to decide with the site, as
 * story 328 says of an administrator's removal.
 */
export function removeExtension(siteDir: string, id: string): { removed: boolean } {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return { removed: false }
  const root = rootOf(siteDir, id)
  const recorded = id in readRecord(siteDir)
  const rooted = existsSync(root)
  if (rooted) rmSync(root, { recursive: true, force: true })
  if (recorded) forgetExtension(siteDir, id)
  return { removed: rooted || recorded }
}
