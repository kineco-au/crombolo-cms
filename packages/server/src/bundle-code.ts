/**
 * A site's code from its bundle (story 192): checked against this CMS, and
 * installed into a directory a host starts. The `@crombolo/*` packages are the
 * host's to provide, so neither ever installs one: the site lists them as peers
 * and the install omits peers. `docs/bundles.md`, "A site's bundle with code".
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  discoverBundles,
  INSTALLED_AS_DEPENDENCY,
  isSemverRange,
  type PackageJson,
  packageInRoot,
  peerRangeProblem,
  RECORD_FILE,
  type RecordedExtension,
  ROOTS_DIR,
  readPackageJson,
  readRecord,
  recordProblems,
  resolvePackageDir,
} from '@crombolo/backoffice-host/registry'
import { loadBundleCode } from '@crombolo/transfer'
import { VERSION } from './config.ts'
import { lockedIntegrity } from './extension-install.ts'

const SCOPE = '@crombolo/'
const CORE_PACKAGE = '@crombolo/crombolo'

export interface BundleCodeOptions {
  /** The CMS version the code is checked against; this one by default. */
  coreVersion?: string
}

export interface BundleCodeCheck {
  /** Every reason the code cannot run here; empty when it can. */
  problems: string[]
  /** The ids of the server bundles the code's packages carry. */
  serverBundles: string[]
  /** How many files the bundle's code is. */
  files: number
}

/** An extension's root the code carries, and whether it installed as its record says (story 332). */
export interface BundleCodeRoot {
  id: string
  ok: boolean
  problem?: string
}

export interface BundleCodeInstall {
  problems: string[]
  dir: string
  files: number
  /** Each extension root the code carries, installed from its own lockfile. */
  roots: BundleCodeRoot[]
}

/** `bun install` exactly as the lockfile says: no lifecycle scripts, and no peers. */
async function frozenInstall(dir: string): Promise<string | undefined> {
  const run = Bun.spawn(
    [process.execPath, 'install', '--frozen-lockfile', '--ignore-scripts', '--omit', 'peer'],
    { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
  )
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ])
  if (code === 0) return undefined
  const tail = `${err}\n${out}`.trim().split('\n').slice(-5).join(' / ')
  return `the install from its bun.lock failed: ${tail}`
}

/** Every `@crombolo/*` package an install put anywhere under `node_modules`. */
function cromboloCopies(root: string): string[] {
  const found: string[] = []
  const walk = (modules: string): void => {
    if (!existsSync(modules)) return
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') continue
      const at = join(modules, entry.name)
      if (entry.name === SCOPE.slice(0, -1)) {
        for (const pkg of readdirSync(at)) found.push(relative(root, join(at, pkg)))
        continue
      }
      const packages = entry.name.startsWith('@')
        ? readdirSync(at).map((name) => join(at, name))
        : [at]
      for (const pkg of packages) walk(join(pkg, 'node_modules'))
    }
  }
  walk(join(root, 'node_modules'))
  return found.sort()
}

/** What the site's `package.json` declares wrongly for a host that provides the CMS. */
function declarationProblems(json: PackageJson, coreVersion: string): string[] {
  const problems: string[] = []
  for (const name of Object.keys(json.dependencies ?? {}).sort())
    if (name.startsWith(SCOPE))
      problems.push(
        `package.json lists ${name} under dependencies; the CMS that runs the site provides it, so it belongs under peerDependencies`,
      )
  const range = json.peerDependencies?.[CORE_PACKAGE]
  if (range && isSemverRange(range) && !Bun.semver.satisfies(coreVersion, range))
    problems.push(
      `the site is written for ${CORE_PACKAGE} ${range}, and this CMS is ${coreVersion}`,
    )
  return problems
}

/**
 * The `@crombolo/*` packages the site peers on, linked from this CMS, as a host
 * provides them; a name this CMS cannot provide is a problem.
 */
function linkCms(json: PackageJson, dir: string): string[] {
  const problems: string[] = []
  for (const name of Object.keys(json.peerDependencies ?? {}).sort()) {
    if (!name.startsWith(SCOPE)) continue
    const provided = resolvePackageDir(import.meta.dir, name)
    if (!provided) {
      problems.push(`the site needs ${name}, and this CMS does not provide it`)
      continue
    }
    const target = join(dir, 'node_modules', name)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(provided, target, 'dir')
  }
  return problems
}

/** The extension roots under a directory: each folder in `extensions/`. */
function rootIds(dir: string): string[] {
  const roots = join(dir, ROOTS_DIR)
  if (!existsSync(roots)) return []
  return readdirSync(roots, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** Why what a root installed is not what the record names, or undefined when it is. */
function rootMismatch(
  dir: string,
  id: string,
  line: RecordedExtension | undefined,
): string | undefined {
  if (!line) return undefined
  const installed = readPackageJson(join(packageInRoot(dir, id, line.name), 'package.json'))
  if (!installed) return `its bun.lock does not install ${line.name}, which ${RECORD_FILE} names`
  if (installed.version !== line.version)
    return `it installs ${line.name}@${installed.version}, where ${RECORD_FILE} names ${line.version}`
  const locked = lockedIntegrity(join(dir, ROOTS_DIR, id), line.name)
  if (line.integrity && locked && locked !== line.integrity)
    return `its bun.lock holds ${line.name} as ${locked}, where ${RECORD_FILE} records ${line.integrity}`
  return undefined
}

/**
 * Each extension root installed from its own lockfile, as `site apply` installs
 * one (story 326), then held to its line in the record. One that fails leaves
 * the others to install.
 */
async function installRoots(dir: string): Promise<BundleCodeRoot[]> {
  const record = readRecord(dir)
  const out: BundleCodeRoot[] = []
  for (const id of rootIds(dir)) {
    const root = join(dir, ROOTS_DIR, id)
    const problem = existsSync(join(root, 'bun.lock'))
      ? ((await frozenInstall(root)) ?? rootMismatch(dir, id, record[id]))
      : 'it has no bun.lock, so it could not be installed as it was tested'
    out.push(problem ? { id, ok: false, problem } : { id, ok: true })
  }
  return out
}

const rootProblems = (roots: readonly BundleCodeRoot[]): string[] =>
  roots.flatMap((root) => (root.problem ? [`${ROOTS_DIR}/${root.id}/: ${root.problem}`] : []))

/** Whether the site's config imports a package: the boot runs one it wires, the old way. */
function configImports(dir: string, name: string): boolean {
  const config = ['crombolo.config.ts', 'crombolo.config.js', 'crombolo.config.mjs']
    .map((file) => join(dir, file))
    .find((file) => existsSync(file))
  if (!config) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`(?:from|import)\\s*\\(?\\s*['"]${escaped}(?:/[^'"]*)?['"]`).test(
    readFileSync(config, 'utf8'),
  )
}

/**
 * Every reason a bundle's code cannot run on this CMS: its hash, a frozen
 * install, `@crombolo/*` installed beside it, the bundle packages it declares,
 * and the extension roots it carries against its record. All of them, not the first. The site's code is never run here: a
 * host has not yet accepted it, so its config's wiring is checked by the boot.
 */
export async function checkBundleCode(
  packageDir: string,
  options: BundleCodeOptions = {},
): Promise<BundleCodeCheck> {
  const coreVersion = options.coreVersion ?? VERSION
  const loaded = loadBundleCode(packageDir)
  if (!loaded.dir) return { problems: loaded.problems, serverBundles: [], files: 0 }
  const result: BundleCodeCheck = {
    problems: [...loaded.problems],
    serverBundles: [],
    files: loaded.paths.length,
  }
  const json = JSON.parse(readFileSync(join(loaded.dir, 'package.json'), 'utf8')) as PackageJson
  result.problems.push(...declarationProblems(json, coreVersion))

  const work = mkdtempSync(join(tmpdir(), 'crombolo-bundle-code-'))
  try {
    cpSync(loaded.dir, work, { recursive: true })
    const failed = await frozenInstall(work)
    if (failed) {
      result.problems.push(failed)
      return result
    }
    for (const copy of cromboloCopies(work))
      result.problems.push(
        `${copy} is installed with the code; the CMS provides @crombolo packages, so nothing the site installs may depend on one directly`,
      )
    result.problems.push(...linkCms(json, work))
    result.problems.push(...rootProblems(await installRoots(work)))
    result.problems.push(...recordProblems(work))

    const discovered = discoverBundles(work)
    for (const entry of discovered.problems)
      for (const problem of entry.problems) result.problems.push(`${entry.packageName}: ${problem}`)
    for (const bundle of discovered.bundles) {
      const peer = peerRangeProblem(bundle, coreVersion)
      if (peer) result.problems.push(peer)
      // Story 332: the boot names an extension the site depends on, and does not run it.
      if (bundle.dependency && !(bundle.carries.server && configImports(work, bundle.packageName)))
        result.problems.push(`${bundle.packageName} (${bundle.id}): ${INSTALLED_AS_DEPENDENCY}`)
    }
    result.serverBundles = discovered.bundles
      .filter((bundle) => bundle.carries.server)
      .map((bundle) => bundle.id)
    return result
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * The bundle's code installed into `dir`, ready for a host to start once it
 * provides the `@crombolo/*` packages, with each extension root it carries. Refuses a directory that already holds
 * files, rather than mixing two sites' code.
 */
export async function installBundleCode(
  packageDir: string,
  dir: string,
): Promise<BundleCodeInstall> {
  const loaded = loadBundleCode(packageDir)
  if (!loaded.dir || loaded.problems.length > 0)
    return { problems: loaded.problems, dir, files: 0, roots: [] }
  if (existsSync(dir) && readdirSync(dir).length > 0)
    return {
      problems: [`${dir} already holds files; install into an empty directory`],
      dir,
      files: 0,
      roots: [],
    }
  mkdirSync(dir, { recursive: true })
  cpSync(loaded.dir, dir, { recursive: true })
  const problems: string[] = []
  const failed = await frozenInstall(dir)
  if (failed) problems.push(failed)
  else
    for (const copy of cromboloCopies(dir))
      problems.push(
        `${copy} was installed with the code; the CMS provides @crombolo packages, so nothing the site installs may depend on one directly`,
      )
  // Story 332: each extension root the code carries, as `site apply` installs it.
  const roots = await installRoots(dir)
  problems.push(...rootProblems(roots))
  return { problems, dir, files: loaded.paths.length, roots }
}
