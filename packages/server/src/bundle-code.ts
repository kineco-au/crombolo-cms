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
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  discoverBundles,
  isSemverRange,
  type PackageJson,
  peerRangeProblem,
  resolvePackageDir,
} from '@crombolo/backoffice-host'
import { loadBundleCode } from '@crombolo/transfer'
import { type ServerBundle, validateServerBundles } from './bundles.ts'
import { VERSION } from './config.ts'

const SCOPE = '@crombolo/'
const CORE_PACKAGE = '@crombolo/crombolo'

/** How long reading a site's config may take before it is taken to have hung. */
const CONFIG_TIMEOUT_MS = 60_000

export interface BundleCodeOptions {
  /** The CMS version the code is checked against; this one by default. */
  coreVersion?: string
}

export interface BundleCodeCheck {
  /** Every reason the code cannot run here; empty when it can. */
  problems: string[]
  /** The bundle ids `crombolo.config.ts` wires. */
  wired: string[]
  /** How many files the bundle's code is. */
  files: number
}

export interface BundleCodeInstall {
  problems: string[]
  dir: string
  files: number
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

const MARKER = '@@crombolo-bundles@@'

/** Run in a process of its own: the wired bundles, as data, after a marker line. */
const READ_CONFIG = `const config = (await import(process.argv[2])).default ?? {}
const bundles = (config.bundles ?? []).map((b) => ({
  id: b.id,
  section: b.section,
  capabilities: b.capabilities ?? [],
  routes: (b.routes ?? []).map((r) => ({ method: r.method, path: r.path })),
  ...(b.tables ? { tables: b.tables } : {}),
}))
process.stdout.write('\\n${MARKER}' + JSON.stringify(bundles) + '\\n')
`

/**
 * The bundles `crombolo.config.ts` wires, read in a `bun` process given none
 * of the caller's environment, so a config that reads a secret finds none and
 * one that hangs is stopped.
 */
async function wiredBundles(dir: string): Promise<{ bundles: ServerBundle[]; problem?: string }> {
  const config = join(dir, 'crombolo.config.ts')
  if (!existsSync(config)) return { bundles: [] }
  const scratch = mkdtempSync(join(tmpdir(), 'crombolo-read-config-'))
  try {
    const script = join(scratch, 'read-config.ts')
    writeFileSync(script, READ_CONFIG)
    const run = Bun.spawn([process.execPath, script, config], {
      cwd: dir,
      env: {},
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => run.kill(), CONFIG_TIMEOUT_MS)
    const [out, err, code] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
      run.exited,
    ])
    clearTimeout(timer)
    const marker = out.split('\n').find((line) => line.startsWith(MARKER))
    if (code !== 0 || !marker) {
      const tail = err.trim().split('\n').slice(-5).join(' / ')
      return {
        bundles: [],
        problem: `crombolo.config.ts could not be read: ${tail || `exit ${code}`}`,
      }
    }
    return { bundles: JSON.parse(marker.slice(MARKER.length)) as ServerBundle[] }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Every reason a bundle's code cannot run on this CMS: its hash, a frozen
 * install, `@crombolo/*` installed beside it, and the server bundles its config
 * wires, by the rules the boot applies. All of them, not the first.
 */
export async function checkBundleCode(
  packageDir: string,
  options: BundleCodeOptions = {},
): Promise<BundleCodeCheck> {
  const coreVersion = options.coreVersion ?? VERSION
  const loaded = loadBundleCode(packageDir)
  if (!loaded.dir) return { problems: loaded.problems, wired: [], files: 0 }
  const result: BundleCodeCheck = {
    problems: [...loaded.problems],
    wired: [],
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

    const read = await wiredBundles(work)
    if (read.problem) result.problems.push(read.problem)
    result.wired = read.bundles.map((bundle) => bundle.id)

    const discovered = discoverBundles(work)
    for (const entry of discovered.problems)
      for (const problem of entry.problems) result.problems.push(`${entry.packageName}: ${problem}`)
    const wired = new Set(result.wired)
    for (const bundle of discovered.bundles) {
      if (wired.has(bundle.id)) continue
      const peer = peerRangeProblem(bundle, coreVersion)
      if (peer) result.problems.push(peer)
    }
    result.problems.push(...validateServerBundles(read.bundles, discovered.bundles, coreVersion))
    return result
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * The bundle's code installed into `dir`, ready for a host to start once it
 * provides the `@crombolo/*` packages. Refuses a directory that already holds
 * files, rather than mixing two sites' code.
 */
export async function installBundleCode(
  packageDir: string,
  dir: string,
): Promise<BundleCodeInstall> {
  const loaded = loadBundleCode(packageDir)
  if (!loaded.dir || loaded.problems.length > 0) return { problems: loaded.problems, dir, files: 0 }
  if (existsSync(dir) && readdirSync(dir).length > 0)
    return {
      problems: [`${dir} already holds files; install into an empty directory`],
      dir,
      files: 0,
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
  return { problems, dir, files: loaded.paths.length }
}
