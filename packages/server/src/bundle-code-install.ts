/**
 * The code a bundle carries, installed into the site it is applied to (story
 * 241), which story 192 left to a host. Each file under `code/` lands at its site
 * path, what it replaces is kept under the run, and a changed `package.json` or
 * `bun.lock` is installed from the lockfile with no install scripts. The server
 * loads code at boot, so the change waits for `crombolo restart`.
 * `docs/bundles.md`, "A site's bundle with code".
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CODE_DIR } from '@crombolo/transfer'
import type { CarriedSections, FileAction, SectionFile } from './bundle-sections.ts'
import { RUN_BACKUP_DIR } from './bundle-sections.ts'
import type { CromboloConfig } from './config.ts'
import { markRestartPending } from './restart-pending.ts'

/** Where a run keeps the code it replaced, and what it did to each file. */
const CODE_RUN_DIR = 'code'
const CODE_RECORD = 'code.json'
const DEPENDENCY_FILES = new Set(['package.json', 'bun.lock'])

interface CodeRecord {
  files: { path: string; action: FileAction }[]
  /** Whether the dependencies were installed, and so are installed again on a revert. */
  installed: boolean
}

export interface CodeInstall {
  written: string[]
  replaced: string[]
  /** Whether `bun install` ran, because the dependencies changed. */
  installed: boolean
  problems: string[]
}

const sitePath = (path: string) => path.slice(`${CODE_DIR}/`.length)

function actionFor(target: string, bytes: Uint8Array): FileAction {
  if (!existsSync(target)) return 'create'
  return Buffer.from(readFileSync(target)).equals(Buffer.from(bytes)) ? 'unchanged' : 'overwrite'
}

const bytesOf = (carried: CarriedSections, path: string): Uint8Array => {
  const file = carried.files.get(path)
  if (!file) throw new Error(`${path} is declared but was not read`)
  return new Uint8Array(readFileSync(file))
}

/** Read-only: what installing the bundle's code here would do, file by file. */
export function planCode(config: CromboloConfig, carried: CarriedSections): SectionFile[] {
  return (carried.carries.code ?? []).map((path) => {
    const target = join(config.siteDir, sitePath(path))
    return { path, target, action: actionFor(target, bytesOf(carried, path)) }
  })
}

/** The files installing it would change; none means the site already runs this code. */
export const codeChanges = (plan: readonly SectionFile[]): SectionFile[] =>
  plan.filter((file) => file.action !== 'unchanged')

/** `bun install` from the site's lockfile, running no package's install scripts. */
async function installFromLockfile(dir: string): Promise<string | undefined> {
  const run = Bun.spawn([process.execPath, 'install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ])
  if (code === 0) return undefined
  const tail = `${err}\n${out}`.trim().split('\n').slice(-5).join(' / ')
  return `the install from its bun.lock failed: ${tail}`
}

/**
 * Writes the bundle's code into the site, keeping what it replaces under the
 * run's directory, then installs the dependencies when they changed. Run after
 * the content has committed, as the other sections' swap is.
 */
export async function installCode(
  config: CromboloConfig,
  carried: CarriedSections,
  runDir: string,
  label: string,
): Promise<CodeInstall> {
  const plan = planCode(config, carried)
  const changed = codeChanges(plan)
  const result: CodeInstall = { written: [], replaced: [], installed: false, problems: [] }
  if (changed.length === 0) return result
  const keep = join(runDir, CODE_RUN_DIR)
  for (const file of changed) {
    if (file.action === 'overwrite') {
      const kept = join(keep, sitePath(file.path))
      mkdirSync(dirname(kept), { recursive: true })
      copyFileSync(file.target, kept)
      result.replaced.push(file.target)
    }
    mkdirSync(dirname(file.target), { recursive: true })
    writeFileSync(file.target, bytesOf(carried, file.path))
    result.written.push(file.target)
  }
  const dependencies = changed.some((file) => DEPENDENCY_FILES.has(sitePath(file.path)))
  if (dependencies) {
    const failed = await installFromLockfile(config.siteDir)
    if (failed) result.problems.push(failed)
    else result.installed = true
  }
  const record: CodeRecord = {
    files: changed.map((file) => ({ path: sitePath(file.path), action: file.action })),
    installed: dependencies,
  }
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, CODE_RECORD), `${JSON.stringify(record, null, 2)}\n`)
  markRestartPending(config.siteDir, `${label}: ${changed.length} code file(s) installed`)
  return result
}

function codeRecord(config: CromboloConfig, runId: string): CodeRecord | undefined {
  const file = join(config.siteDir, RUN_BACKUP_DIR, runId, CODE_RECORD)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as CodeRecord
  } catch {
    return undefined
  }
}

/** Whether a run installed code, so that reverting it changes code too. */
export const installedCode = (config: CromboloConfig, runId: string): boolean =>
  (codeRecord(config, runId)?.files.length ?? 0) > 0

export interface CodeRevert {
  restored: string[]
  removed: string[]
  installed: boolean
  problems: string[]
}

/** Puts back the code a run replaced, removes what it added, and installs again. */
export async function revertCode(config: CromboloConfig, runId: string): Promise<CodeRevert> {
  const result: CodeRevert = { restored: [], removed: [], installed: false, problems: [] }
  const record = codeRecord(config, runId)
  if (!record || record.files.length === 0) return result
  const keep = join(config.siteDir, RUN_BACKUP_DIR, runId, CODE_RUN_DIR)
  for (const file of record.files) {
    const target = join(config.siteDir, file.path)
    if (file.action === 'overwrite') {
      const kept = join(keep, file.path)
      if (!existsSync(kept)) continue
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(kept, target)
      result.restored.push(target)
    } else if (file.action === 'create' && existsSync(target)) {
      rmSync(target, { force: true })
      result.removed.push(target)
    }
  }
  if (record.installed) {
    const failed = await installFromLockfile(config.siteDir)
    if (failed) result.problems.push(failed)
    else result.installed = true
  }
  markRestartPending(config.siteDir, `run ${runId} reverted: its code put back`)
  return result
}
