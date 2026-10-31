/**
 * Crombolo's fork of Umbraco's back-office client (story 235). It lives in this
 * repository as two branches: `umbraco/upstream` (a snapshot of Umbraco's
 * `src/Umbraco.Web.UI.Client` per release) and `umbraco/crombolo` (Crombolo's
 * commits on top). `main` builds the commit named in the pin file.
 *
 *   bun run fork:checkout   the worktree at vendor/umbraco-client, on umbraco/crombolo
 *   bun run fork:pin        pin the worktree's HEAD as the commit main builds
 *   bun run fork:build      build the pinned commit's npm package (cached by commit)
 *
 * The build runs Umbraco's own `build:for:npm` and `npm pack` in a clean export
 * of the pinned commit, so it needs Node and npm (the client's `engines`), and
 * gives the package `vendor:backoffice` used to take from npm. docs/backoffice-hosting.md.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
export const WORKTREE = join(ROOT, 'vendor/umbraco-client')
export const PIN_FILE = join(ROOT, 'packages/backoffice-dist/UMBRACO_CLIENT')
const BUILDS = join(ROOT, 'output/umbraco-client')
const BRANCH = 'umbraco/crombolo'
const UPSTREAM = 'umbraco/upstream'

function run(cmd: string[], cwd = ROOT, quiet = false): string {
  const result = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
    throw new Error(`${cmd.join(' ')} failed:\n${output.split('\n').slice(-20).join('\n')}`)
  }
  const out = result.stdout.toString().trim()
  if (!quiet && out) console.log(out)
  return out
}

const hasRef = (ref: string) =>
  Bun.spawnSync(['git', 'rev-parse', '--verify', '--quiet', ref], { cwd: ROOT }).exitCode === 0

/** The fork branches here, fetched from origin when this clone lacks them. */
function ensureBranches(): void {
  for (const branch of [UPSTREAM, BRANCH]) {
    if (hasRef(branch)) continue
    run(['git', 'fetch', 'origin', `${branch}:${branch}`])
  }
}

/** The commit `main` builds. */
export function pinnedCommit(): string {
  const pin = readFileSync(PIN_FILE, 'utf8').trim()
  if (!/^[0-9a-f]{40}$/.test(pin)) throw new Error(`${PIN_FILE} does not name a commit: "${pin}"`)
  return pin
}

export function checkout(): void {
  ensureBranches()
  if (existsSync(join(WORKTREE, '.git'))) {
    console.log(`fork: worktree already at ${WORKTREE}`)
    return
  }
  run(['git', 'worktree', 'add', WORKTREE, BRANCH])
  console.log(`fork: ${BRANCH} checked out at ${WORKTREE}`)
}

export function pin(): void {
  if (!existsSync(join(WORKTREE, '.git')))
    throw new Error('No worktree: run `bun run fork:checkout`')
  if (run(['git', 'status', '--porcelain'], WORKTREE, true))
    throw new Error('The worktree has uncommitted changes: commit them on the fork first')
  const head = run(['git', 'rev-parse', 'HEAD'], WORKTREE, true)
  writeFileSync(PIN_FILE, `${head}\n`)
  console.log(`fork: pinned ${head}`)
}

/**
 * The pinned commit's npm package, unpacked: what `npm pack` gives, as Umbraco
 * publishes it. Built once per commit; `node_modules` is shared between builds
 * with the same lockfile.
 */
export function build(): string {
  const commit = pinnedCommit()
  const out = join(BUILDS, commit)
  const pkg = join(out, 'package')
  if (existsSync(join(pkg, 'package.json'))) return pkg
  if (!hasRef(commit)) ensureBranches()
  if (!hasRef(commit)) throw new Error(`The pinned fork commit ${commit} is not in this clone`)

  console.log(`fork: building ${commit.slice(0, 12)}`)
  rmSync(out, { recursive: true, force: true })
  const src = join(out, 'src')
  mkdirSync(src, { recursive: true })
  const archive = Bun.spawnSync(['git', 'archive', commit], { cwd: ROOT, stdout: 'pipe' })
  if (archive.exitCode !== 0) throw new Error(`git archive ${commit} failed`)
  writeFileSync(join(out, 'src.tar'), archive.stdout)
  run(['tar', '-xf', join(out, 'src.tar'), '-C', src])
  rmSync(join(out, 'src.tar'))

  run(['npm', 'ci', '--no-audit', '--no-fund', '--loglevel=error'], src, true)
  run(['npm', 'run', 'build:for:npm'], src, true)
  run(['npm', 'pack', '--pack-destination', out], src, true)
  const tarball = run(['sh', '-c', 'ls *.tgz'], out, true).split('\n')[0] as string
  run(['tar', '-xzf', join(out, tarball), '-C', out])
  rmSync(src, { recursive: true, force: true })
  console.log(`fork: built ${pkg}`)
  return pkg
}

if (import.meta.main) {
  const command = Bun.argv[2]
  if (command === 'checkout') checkout()
  else if (command === 'pin') pin()
  else if (command === 'build') console.log(build())
  else {
    console.error('Usage: bun run scripts/fork.ts checkout|pin|build')
    process.exit(1)
  }
}
