/**
 * `crombolo extension migrate` (story 320): a schema 4 extension rewritten to
 * schema 5's layout. Its server code moves under `src/server/`, its back-office
 * code (`plugin/`, and whatever else its manifest names) under `src/backoffice/`,
 * and its manifest, exports and permissions follow. `planMigration` decides and
 * writes nothing; `applyMigration` makes the moves.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'
import {
  BACKOFFICE_CODE,
  BACKOFFICE_DIR,
  BUNDLE_SCHEMA_VERSION,
  backOfficeModules,
  exportedEntry,
  type PackageJson,
  REASON_MAX,
  readPackageJson,
  SERVER_DIR,
} from '@crombolo/backoffice-host/registry'

export interface MigrationPlan {
  /** Each file's move, package-relative, in the order made. */
  moves: Array<{ from: string; to: string }>
  /** The package.json it writes. */
  json: PackageJson
  /** Whether it asks for `backoffice.code`. */
  asksForBackOfficeCode: boolean
  /** Whether a `provenance.json` is removed, the digest having changed. */
  dropsSignature: boolean
  /** Relative imports in moved files rewritten to where their targets are, by the file's new path. */
  imports: Array<{ file: string; from: string; to: string }>
  /** Why it cannot be migrated; nothing is moved when there are any. */
  problems: string[]
}

const SOURCE = /\.(m?[jt]s|[jt]sx)$/
const RELATIVE_IMPORT =
  /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g

/** Every file under a directory, package-relative and `/`-separated. */
function filesUnder(root: string, dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(root, path))
    else out.push(relative(root, path).split(sep).join('/'))
  }
  return out
}

/** Each relative import a module makes, as written and the package-relative file it names. */
function relativeImports(root: string, file: string): Array<{ specifier: string; target: string }> {
  const text = readFileSync(join(root, file), 'utf8')
  const out: Array<{ specifier: string; target: string }> = []
  for (const match of text.matchAll(RELATIVE_IMPORT)) {
    const specifier = match[1] ?? match[2]
    if (!specifier) continue
    const target = normalize(join(dirname(file), specifier))
      .split(sep)
      .join('/')
    const candidates = [
      target,
      `${target}.ts`,
      `${target}.js`,
      `${target}/index.ts`,
      `${target}/index.js`,
    ]
    const found = candidates.find((candidate) => existsSync(join(root, candidate)))
    if (found) out.push({ specifier, target: found })
  }
  return out
}

/** A file and every file it imports by relative path, however deep. */
function graph(root: string, starts: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const pending = [...starts]
  while (pending.length > 0) {
    const file = pending.pop() as string
    if (seen.has(file) || !existsSync(join(root, file))) continue
    seen.add(file)
    if (SOURCE.test(file)) pending.push(...relativeImports(root, file).map((i) => i.target))
  }
  return seen
}

const strip = (path: string) => path.replace(/^\.\//, '')

/** Where a back-office file goes: `plugin/x.js` to `src/backoffice/x.js`, anything else kept below it. */
const backOfficeTarget = (path: string) =>
  `${BACKOFFICE_DIR}/${path.startsWith('plugin/') ? path.slice('plugin/'.length) : path}`

/** A server file's new place: `src/x.ts` to `src/server/x.ts`. */
const serverTarget = (path: string) =>
  path.startsWith('src/') ? `${SERVER_DIR}/${path.slice('src/'.length)}` : `${SERVER_DIR}/${path}`

/** What migrating the package at `dir` would do. Reads, never writes. */
export function planMigration(dir: string, options: { reason?: string } = {}): MigrationPlan {
  const json = readPackageJson(join(dir, 'package.json'))
  const empty = (problem: string): MigrationPlan => ({
    moves: [],
    json: json ?? {},
    asksForBackOfficeCode: false,
    dropsSignature: false,
    imports: [],
    problems: [problem],
  })
  if (!json) return empty('it has no package.json')
  const field = json.crombolo as Record<string, unknown> | undefined
  if (field?.bundleType !== 'extension') return empty('it is not an extension')
  const schema = typeof field.schemaVersion === 'number' ? field.schemaVersion : 1
  if (schema >= BUNDLE_SCHEMA_VERSION)
    return empty(`it is already written for bundle schema ${schema}`)
  if (field.permissions !== undefined && Array.isArray(field.permissions))
    return empty(
      'its permissions give no reasons (bundle schema 3): give each its reason, as schema 4 does, then migrate it',
    )

  const problems: string[] = []
  const modules = backOfficeModules(field).map(strip)
  for (const module of modules)
    if (module.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(module))
      problems.push(`its manifest names ${module}, which is not a file in the package`)
    else if (!existsSync(join(dir, module)))
      problems.push(`its manifest names ${module}, which it does not hold`)

  // The back-office half: plugin/, and everything the manifest's modules import.
  const backOffice = new Set([
    ...filesUnder(dir, join(dir, 'plugin')),
    ...[
      ...graph(
        dir,
        modules.filter((module) => existsSync(join(dir, module))),
      ),
    ].filter((file) => SOURCE.test(file)),
  ])
  // The server half: everything its entry imports, and the rest of src/ the back office does not use.
  const entry = field.server !== undefined ? exportedEntry(json) : undefined
  // Code moves; what code reads, such as its package.json, stays where it is.
  const fromEntry = new Set(
    [...(entry ? graph(dir, [entry]) : [])].filter((file) => SOURCE.test(file)),
  )
  const server = new Set([
    ...fromEntry,
    ...filesUnder(dir, join(dir, 'src')).filter((file) => !backOffice.has(file)),
  ])
  for (const file of fromEntry)
    if (backOffice.has(file))
      problems.push(
        file.startsWith('plugin/')
          ? `its server half imports ${file}, which is back-office code: move what it needs into src/, then migrate it`
          : `${file} is used by both its server half and its back-office code: give each half its own copy, then migrate it`,
      )
  const asks = modules.length > 0
  const reason = options.reason?.trim()
  if (asks && !reason)
    problems.push(
      `it runs code in the back office, so it asks for "${BACKOFFICE_CODE}", which needs its reason: give it with --reason`,
    )
  else if (reason && reason.length > REASON_MAX)
    problems.push(`the reason is longer than ${REASON_MAX} characters`)
  if (problems.length > 0) return { ...empty(''), problems }

  const moves: MigrationPlan['moves'] = [
    ...[...server].sort().map((from) => ({ from, to: serverTarget(from) })),
    ...[...backOffice].sort().map((from) => ({ from, to: backOfficeTarget(from) })),
  ].filter((move) => move.from !== move.to)
  const moved = new Map(moves.map((move) => [move.from, move.to]))
  const rewrite = (path: string) => {
    const to = moved.get(strip(path))
    return to ? (path.startsWith('./') ? `./${to}` : to) : path
  }
  const rewriteModules = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteModules)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        ['element', 'api', 'js', 'loader'].includes(key) && typeof item === 'string'
          ? rewrite(item)
          : rewriteModules(item),
      ]),
    )
  }
  const rewriteExports = (value: unknown): unknown =>
    typeof value === 'string'
      ? rewrite(value)
      : value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [
              key,
              rewriteExports(item),
            ]),
          )
        : value
  const importmap = field.importmap as
    | { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>> }
    | undefined
  const listed = (json as { files?: unknown }).files
  const files = Array.isArray(listed) ? (listed as string[]) : undefined
  const movedRoots = new Set(moves.map((move) => move.from.split('/')[0]))
  const next: PackageJson = {
    ...json,
    ...(json.exports !== undefined ? { exports: rewriteExports(json.exports) } : {}),
    ...(json.main !== undefined ? { main: rewrite(json.main) } : {}),
    ...(files
      ? {
          files: [
            ...new Set([
              ...files.filter((file) => !movedRoots.has(strip(file).replace(/\/$/, ''))),
              'src',
            ]),
          ],
        }
      : {}),
    crombolo: {
      ...field,
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      ...(field.extensions !== undefined ? { extensions: rewriteModules(field.extensions) } : {}),
      ...(importmap
        ? {
            importmap: {
              imports: Object.fromEntries(
                Object.entries(importmap.imports ?? {}).map(([k, v]) => [k, rewrite(v)]),
              ),
              ...(importmap.scopes
                ? {
                    scopes: Object.fromEntries(
                      Object.entries(importmap.scopes).map(([scope, imports]) => [
                        scope,
                        Object.fromEntries(
                          Object.entries(imports).map(([k, v]) => [k, rewrite(v)]),
                        ),
                      ]),
                    ),
                  }
                : {}),
            },
          }
        : {}),
      permissions: {
        ...(asks ? { [BACKOFFICE_CODE]: reason } : {}),
        ...((field.permissions as Record<string, unknown> | undefined) ?? {}),
      },
    },
  }
  // Each moved file's relative imports, pointed at where their targets are now.
  const imports: MigrationPlan['imports'] = []
  for (const move of moves) {
    if (!SOURCE.test(move.from)) continue
    for (const { specifier, target } of relativeImports(dir, move.from)) {
      const now = moved.get(target) ?? target
      let to = relative(dirname(move.to), now).split(sep).join('/')
      if (!to.startsWith('.')) to = `./${to}`
      // Written without its extension, it stays without one.
      if (!/\.[a-z]+$/i.test(specifier.split('/').at(-1) ?? '')) to = to.replace(SOURCE, '')
      if (to !== specifier) imports.push({ file: move.to, from: specifier, to })
    }
  }
  return {
    moves,
    json: next,
    asksForBackOfficeCode: asks,
    dropsSignature: existsSync(join(dir, 'provenance.json')),
    imports,
    problems: [],
  }
}

/** Makes a plan's moves and writes its package.json; a stale signature is removed. */
export function applyMigration(dir: string, plan: MigrationPlan): void {
  if (plan.problems.length > 0) throw new Error(plan.problems.join('; '))
  // Through a staging folder, so `src/x.ts` to `src/server/x.ts` never moves onto itself.
  const staging = join(dir, '.crombolo-migrate')
  rmSync(staging, { recursive: true, force: true })
  for (const move of plan.moves) {
    const target = join(staging, move.to)
    mkdirSync(dirname(target), { recursive: true })
    renameSync(join(dir, move.from), target)
  }
  for (const top of ['plugin', 'src']) {
    const path = join(dir, top)
    if (existsSync(path) && filesUnder(dir, path).length === 0)
      rmSync(path, { recursive: true, force: true })
  }
  for (const move of plan.moves) {
    const target = join(dir, move.to)
    mkdirSync(dirname(target), { recursive: true })
    renameSync(join(staging, move.to), target)
  }
  rmSync(staging, { recursive: true, force: true })
  // Moved directories left empty go too.
  for (const move of plan.moves) {
    let parent = dirname(join(dir, move.from))
    while (
      parent.startsWith(dir) &&
      parent !== dir &&
      existsSync(parent) &&
      readdirSync(parent).length === 0
    ) {
      rmSync(parent, { recursive: true, force: true })
      parent = dirname(parent)
    }
  }
  for (const { file, from, to } of plan.imports) {
    const path = join(dir, file)
    const text = readFileSync(path, 'utf8')
    writeFileSync(path, text.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`))
  }
  if (plan.dropsSignature) rmSync(join(dir, 'provenance.json'), { force: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(plan.json, null, 2)}\n`)
}
