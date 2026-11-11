/**
 * Where installed extensions live (story 326): each in a root of its own,
 * `extensions/<id>/`, with its own `package.json`, `bun.lock` and
 * `node_modules`, and the site's record of them in `crombolo.extensions.json`.
 * Nothing of an extension is a dependency of the site, so trying one never
 * changes the site's lockfile, and removing one is deleting its root. The
 * root's two files and the record are committed; its `node_modules` is not.
 * docs/bundles.md, "The record and the roots".
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The folder every extension's root sits in, at the site's root. */
export const ROOTS_DIR = 'extensions'

/** The site's record of what it has installed. */
export const RECORD_FILE = 'crombolo.extensions.json'

/** One installed extension, as the record keeps it. */
export interface RecordedExtension {
  /** Its npm package name. */
  name: string
  /** The exact version installed. */
  version: string
  /** The tarball's integrity, as the registry or the kept file gives it; absent for a link. */
  integrity?: string
  /** A hash of what it was granted, so an apply can tell a grant that no longer covers it. */
  grant?: string
  /** Installed from a path or a workspace on a developer's machine, outside production only. */
  linked?: boolean
}

/** By extension id, sorted, as the file holds it. */
export type ExtensionRecord = Record<string, RecordedExtension>

export const rootOf = (siteDir: string, id: string): string => join(siteDir, ROOTS_DIR, id)

/** Where an extension's package sits in its root. */
export const packageInRoot = (siteDir: string, id: string, name: string): string =>
  join(rootOf(siteDir, id), 'node_modules', name)

/** The site's record, or an empty one when there is none or it does not read. */
export function readRecord(siteDir: string): ExtensionRecord {
  try {
    const parsed = JSON.parse(readFileSync(join(siteDir, RECORD_FILE), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ExtensionRecord = {}
    for (const [id, line] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = line as Partial<RecordedExtension> | null
      if (entry && typeof entry.name === 'string' && typeof entry.version === 'string')
        out[id] = {
          name: entry.name,
          version: entry.version,
          ...(typeof entry.integrity === 'string' ? { integrity: entry.integrity } : {}),
          ...(typeof entry.grant === 'string' ? { grant: entry.grant } : {}),
          ...(entry.linked === true ? { linked: true } : {}),
        }
    }
    return out
  } catch {
    return {}
  }
}

/** Writes the record sorted by id, so a change to it is a change to one line. */
export function writeRecord(siteDir: string, record: ExtensionRecord): void {
  const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(siteDir, RECORD_FILE), `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Records one extension, replacing what was there for it. */
export function recordExtension(siteDir: string, id: string, line: RecordedExtension): void {
  writeRecord(siteDir, { ...readRecord(siteDir), [id]: line })
}

/** Takes one extension out of the record. */
export function forgetExtension(siteDir: string, id: string): void {
  const { [id]: _, ...rest } = readRecord(siteDir)
  writeRecord(siteDir, rest)
}

/** A root ready for `bun add`: its folder and a `package.json` that is nobody's package. */
export function prepareRoot(siteDir: string, id: string): string {
  const root = rootOf(siteDir, id)
  mkdirSync(root, { recursive: true })
  const manifest = join(root, 'package.json')
  if (!existsSync(manifest))
    writeFileSync(
      manifest,
      `${JSON.stringify({ name: `${id}-root`, private: true, dependencies: {} }, null, 2)}\n`,
    )
  return root
}

/** Why the record and the roots disagree: a root with no line, or a line with no root. Pure but for reading the folder. */
export function recordProblems(siteDir: string, record = readRecord(siteDir)): string[] {
  const problems: string[] = []
  const roots = existsSync(join(siteDir, ROOTS_DIR))
    ? readdirSync(join(siteDir, ROOTS_DIR), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []
  for (const id of roots)
    if (!record[id])
      problems.push(
        `${ROOTS_DIR}/${id}/ is an extension's root that ${RECORD_FILE} does not name: install it again, or delete the folder`,
      )
  for (const [id, line] of Object.entries(record))
    if (!existsSync(join(packageInRoot(siteDir, id, line.name), 'package.json')))
      problems.push(
        `${RECORD_FILE} names ${line.name}@${line.version} as "${id}", which is not installed in ${ROOTS_DIR}/${id}/: run \`bun install --frozen-lockfile\` there`,
      )
  return problems
}

/** A stable hash of what was granted: permissions and origins, in any order. Pure. */
export function grantHashOf(
  permissions: readonly string[],
  origins: readonly string[] = [],
): string {
  const text = JSON.stringify([[...permissions].sort(), [...origins].sort()])
  return `sha256-${createHash('sha256').update(text).digest('hex').slice(0, 32)}`
}

/** What a dependency of the site that is an extension is told, since this release does not run it. */
export const INSTALLED_AS_DEPENDENCY =
  'it is installed as a dependency of the site, which this release no longer runs: remove it from package.json and install it again with `crombolo extension install`, so it has a root of its own'
