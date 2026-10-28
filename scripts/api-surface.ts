/**
 * The supported API's surface (story 173): every name each entry point of
 * `@crombolo/crombolo` exports, read from its source, for the committed
 * snapshot in `docs/api/surface.json`. `docs/api.md`.
 *
 *   bun run api:snapshot   rewrite the snapshot after a deliberate change
 *
 * Names, not signatures: the entry points are explicit export lists, so the
 * names are exactly what a consumer can import. A wildcard export is refused,
 * because it would make another package's internals part of the promise. The
 * JSX runtimes are the exception: their names are the JSX compiler's contract.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './packages.ts'

export const UMBRELLA = join(ROOT, 'packages/crombolo')
export const SNAPSHOT = join(ROOT, 'docs/api/surface.json')

/** Entry points whose surface is the JSX compiler's, not ours. */
const JSX_RUNTIMES = /(^|\/)(loose\/)?jsx(-dev)?-runtime$/

export interface EntrySurface {
  /** Every exported name, in order; a type-only one prefixed `type `. */
  names: string[]
  /** The names marked `@deprecated` where they are exported. */
  deprecated: string[]
}

export type Surface = Record<string, EntrySurface>

/** The umbrella's entry points: its `exports` map, less the JSX runtimes. */
export function entryPoints(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(UMBRELLA, 'package.json'), 'utf8')) as {
    exports: Record<string, string>
  }
  return Object.fromEntries(
    Object.entries(manifest.exports)
      .filter(([subpath]) => !JSX_RUNTIMES.test(subpath))
      .map(([subpath, file]) => [
        subpath === '.' ? '@crombolo/crombolo' : `@crombolo/crombolo/${subpath.slice(2)}`,
        join(UMBRELLA, file),
      ]),
  )
}

const STATEMENT =
  /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?export\s+(type\s+)?(\*|\{[^}]*\}|(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+[A-Za-z_$][\w$]*)/g

/** One entry point's names, or the reasons it cannot have a surface. */
export function readSurface(file: string): { surface: EntrySurface; problems: string[] } {
  const source = readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '')
  const names: string[] = []
  const deprecated: string[] = []
  const problems: string[] = []
  for (const match of source.matchAll(STATEMENT)) {
    const doc = match[1]
    const typeOnly = match[2]
    const what = match[3] as string
    const isDeprecated = Boolean(doc?.includes('@deprecated'))
    if (what === '*') {
      problems.push(`${file} exports * from another module: list the names instead`)
      continue
    }
    const found: string[] = []
    if (what.startsWith('{')) {
      for (const part of what.slice(1, -1).split(',')) {
        const spec = part.trim()
        if (!spec) continue
        const isType = Boolean(typeOnly) || spec.startsWith('type ')
        const name = (
          spec
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)
            .at(-1) as string
        ).trim()
        found.push(`${isType ? 'type ' : ''}${name}`)
      }
    } else {
      const [, kind, name] =
        what.match(/(function|const|let|class|interface|type|enum)\s+(\S+)$/) ?? []
      if (kind && name)
        found.push(`${kind === 'interface' || kind === 'type' ? 'type ' : ''}${name}`)
    }
    for (const name of found) {
      names.push(name)
      if (isDeprecated) deprecated.push(name.replace(/^type /, ''))
    }
  }
  const sort = (list: string[]) =>
    [...new Set(list)].sort((a, b) =>
      a.replace(/^type /, '').localeCompare(b.replace(/^type /, '')),
    )
  return { surface: { names: sort(names), deprecated: sort(deprecated) }, problems }
}

/** The whole supported surface, read now. */
export function currentSurface(): { surface: Surface; problems: string[] } {
  const surface: Surface = {}
  const problems: string[] = []
  for (const [entry, file] of Object.entries(entryPoints())) {
    const read = readSurface(file)
    surface[entry] = read.surface
    problems.push(...read.problems)
  }
  return { surface, problems }
}

if (import.meta.main) {
  const { surface, problems } = currentSurface()
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  writeFileSync(SNAPSHOT, `${JSON.stringify(surface, null, 2)}\n`)
  // In the repository's own format, so `bun run check` passes on what this writes.
  Bun.spawnSync(['bunx', 'biome', 'format', '--write', SNAPSHOT], { cwd: ROOT })
  console.log(`  wrote    docs/api/surface.json (${Object.keys(surface).length} entry points)`)
}
