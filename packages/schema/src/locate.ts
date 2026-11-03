/**
 * Where a schema problem is, in the site's own terms (story 252): the
 * definition it belongs to and the part of it, such as a property, with the
 * file and line kept for tools and for a file that cannot be read at all.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SchemaProblem } from './model.ts'

export type DefinitionKind =
  | 'content type'
  | 'element type'
  | 'media type'
  | 'member type'
  | 'data type'
  | 'form'
  | 'workflow'
  | 'user group'
  | 'languages'
  | 'site settings'

export interface ProblemDefinition {
  kind: DefinitionKind
  alias: string
  name?: string
}

export interface ProblemPart {
  kind: string
  name: string
}

export interface LocatedProblem extends SchemaProblem {
  /** Absent when the file does not read as a definition. */
  definition?: ProblemDefinition
  part?: ProblemPart
  /** The key within the definition or its part the problem is about: `subject`, `width`. */
  key?: string
  line?: number
}

const DIRS: ReadonlyArray<{ dir: string; header: string; kind: DefinitionKind }> = [
  { dir: 'content-types', header: 'content-type', kind: 'content type' },
  { dir: 'media-types', header: 'media-type', kind: 'media type' },
  { dir: 'member-types', header: 'member-type', kind: 'member type' },
  { dir: 'data-types', header: 'data-type', kind: 'data type' },
  { dir: 'forms', header: 'form', kind: 'form' },
  { dir: 'workflows', header: 'workflow', kind: 'workflow' },
  { dir: 'user-groups', header: 'user-group', kind: 'user group' },
]

const SINGLE_FILES: Record<string, ProblemDefinition> = {
  'schema.toml': { kind: 'site settings', alias: 'site' },
  'languages.toml': { kind: 'languages', alias: 'languages' },
}

const PART_WORDS: Record<string, string> = { allow: 'allowed block' }

type Data = Record<string, unknown>
const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface DefinitionFile {
  /** Relative to the site, as problems name it: `schema/content-types/page.toml`. */
  file: string
  dir: string
  text: string
  data?: Data
  definition?: ProblemDefinition
  /** The alias a file that does not read appears to define, for its follow-on problems. */
  claimedAlias?: string
}

function readDefinitionFile(
  schemaDir: string,
  dir: string,
  name: string,
  header: string | undefined,
  kind: DefinitionKind | undefined,
): DefinitionFile {
  const path = dir ? join(schemaDir, dir, name) : join(schemaDir, name)
  const text = readFileSync(path, 'utf8')
  const file = `schema/${dir ? `${dir}/` : ''}${name}`
  let data: Data | undefined
  try {
    data = Bun.TOML.parse(text) as Data
  } catch {
    const claimed = /^\s*alias\s*=\s*"([^"]+)"/m.exec(text)?.[1]
    return { file, dir, text, ...(claimed ? { claimedAlias: claimed } : {}) }
  }
  if (!header || !kind) {
    const single = SINGLE_FILES[name]
    return { file, dir, text, data, ...(single ? { definition: single } : {}) }
  }
  const table = data[header]
  if (!isRecord(table) || typeof table.alias !== 'string') return { file, dir, text, data }
  return {
    file,
    dir,
    text,
    data,
    definition: {
      kind: kind === 'content type' && table['is-element'] === true ? 'element type' : kind,
      alias: table.alias,
      ...(typeof table.name === 'string' ? { name: table.name } : {}),
    },
  }
}

function definitionFiles(schemaDir: string): DefinitionFile[] {
  const out: DefinitionFile[] = []
  for (const name of Object.keys(SINGLE_FILES))
    if (existsSync(join(schemaDir, name)))
      out.push(readDefinitionFile(schemaDir, '', name, undefined, undefined))
  for (const { dir, header, kind } of DIRS) {
    const at = join(schemaDir, dir)
    if (!existsSync(at)) continue
    for (const name of readdirSync(at)
      .filter((n) => n.endsWith('.toml'))
      .sort())
      out.push(readDefinitionFile(schemaDir, dir, name, header, kind))
  }
  return out
}

const SEGMENT = /([a-z-]+)\[(\d+)\]/g
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Whole-set checks name a part by its alias: `property "body".type`. */
const NAMED = /^([a-z-]+) "([^"]+)"/

/** The deepest indexed part of a path, such as `tab[0].property[1]`, named from the file. */
function partOf(data: Data | undefined, header: string | undefined, path: string) {
  if (!data) return undefined
  const named = NAMED.exec(path)
  if (named) {
    const [, segment, name] = named as unknown as [string, string, string]
    return { kind: PART_WORDS[segment] ?? segment, name }
  }
  let at: unknown = data
  let part: ProblemPart | undefined
  for (const match of path.matchAll(SEGMENT)) {
    const [, segment, index] = match as unknown as [string, string, string]
    const from: unknown =
      isRecord(at) && segment in at ? at : header && isRecord(data[header]) ? data[header] : at
    const list = isRecord(from) ? from[segment] : undefined
    const item = Array.isArray(list) ? list[Number(index)] : undefined
    if (!isRecord(item)) break
    at = item
    const name = [item.alias, item.name, item.caption, item.iso, item.element].find(
      (v): v is string => typeof v === 'string' && v !== '',
    )
    part = { kind: PART_WORDS[segment] ?? segment, name: name ?? `${Number(index) + 1}` }
  }
  return part
}

/** The line each table and key is on, by its dotted path: `tab[0].property[1].width`. */
function linesOf(text: string): Map<string, number> {
  const lines = new Map<string, number>()
  const counts = new Map<string, number>()
  let current: string[] = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    const many = /^\[\[\s*([^\]]+?)\s*\]\]/.exec(line)
    const one = many ? null : /^\[\s*([^\]]+?)\s*\]/.exec(line)
    if (many || one) {
      const names = ((many ?? one)?.[1] ?? '').split('.').map((n) => n.trim())
      const path: string[] = []
      for (const [j, name] of names.entries()) {
        const last = j === names.length - 1
        if (!last) {
          // A parent array of tables is its latest entry
          const prefix = [...path, name].join('.')
          const n = counts.get(prefix)
          path.push(n === undefined ? name : `${name}[${n - 1}]`)
          continue
        }
        if (many) {
          const prefix = [...path, name].join('.')
          const n = counts.get(prefix) ?? 0
          counts.set(prefix, n + 1)
          path.push(`${name}[${n}]`)
        } else path.push(name)
      }
      current = path
      lines.set(current.join('.'), i + 1)
      return
    }
    const key = /^("[^"]+"|[A-Za-z0-9_-]+)\s*=/.exec(line)?.[1]?.replace(/"/g, '')
    if (key) {
      const at = [...current, key].join('.')
      if (!lines.has(at)) lines.set(at, i + 1)
    }
  })
  return lines
}

function lineOf(text: string, header: string | undefined, path: string): number | undefined {
  if (!path) return undefined
  const named = NAMED.exec(path) as [string, string, string] | null
  if (named) {
    const key = named[1] === 'language' ? 'iso' : 'alias'
    const lines = text.split('\n')
    const at = lines.findIndex((line) =>
      new RegExp(`^\\s*${key}\\s*=\\s*"${escaped(named[2])}"`).test(line),
    )
    if (at < 0) return undefined
    // The key after the part, such as `.type`, within the part's own table
    const rest = path.slice(named[0].length).replace(/^\./, '').split('.')[0]
    if (rest)
      for (let i = at + 1; i < lines.length && !/^\s*\[/.test(lines[i] ?? ''); i++)
        if (new RegExp(`^\\s*${escaped(rest)}\\s*=`).test(lines[i] ?? '')) return i + 1
    return at + 1
  }
  const lines = linesOf(text)
  const parts = path.split('.')
  for (let n = parts.length; n > 0; n--) {
    const at = parts.slice(0, n).join('.')
    const found = lines.get(at) ?? (header ? lines.get(`${header}.${at}`) : undefined)
    if (found !== undefined) return found
  }
  return undefined
}

/** What follows the part in a path, or the header: `workflow[0].settings.subject` is `settings.subject`. */
function keyOf(path: string, header: string | undefined): string | undefined {
  const named = NAMED.exec(path)
  const rest = named
    ? path.slice(named[0].length)
    : path.includes(']')
      ? path.slice(path.lastIndexOf(']') + 1)
      : header && path.startsWith(`${header}.`)
        ? path.slice(header.length)
        : ''
  const key = rest.replace(/^\./, '')
  return key && !key.includes('[') ? key : undefined
}

/** A definition checked before its file is written, named as whole-set checks name it. */
function unwritten(file: string): ProblemDefinition | undefined {
  const single = SINGLE_FILES[`${file.replace(/^schema\//, '').replace(/\.toml$/, '')}.toml`]
  if (single) return single
  const named = /^schema\/([a-z-]+)\/([^/]+)$/.exec(file) as [string, string, string] | null
  if (!named || named[2].endsWith('.toml')) return undefined
  const kind = DIRS.find((d) => d.dir === named[1])?.kind
  return kind ? { kind, alias: named[2] } : undefined
}

/**
 * Each problem with its definition, part and line. A problem a file that
 * cannot be read causes in another file, such as an unknown type that file
 * defines, is dropped: the unreadable file is the problem to fix.
 */
export function locateProblems(
  problems: readonly SchemaProblem[],
  schemaDir: string,
): LocatedProblem[] {
  const files = existsSync(schemaDir) ? definitionFiles(schemaDir) : []
  const byFile = new Map(files.map((f) => [f.file, f]))
  const unreadable = files.filter((f) => f.data === undefined)
  const claimed = unreadable.flatMap((f) => (f.claimedAlias ? [f.claimedAlias] : []))
  const headerOf = (dir: string) => DIRS.find((d) => d.dir === dir)?.header

  const fileOf = (problem: SchemaProblem): DefinitionFile | undefined => {
    const direct = byFile.get(problem.file) ?? byFile.get(`${problem.file}.toml`)
    if (direct) return direct
    // Whole-set checks name a definition as `schema/<dir>/<alias>`
    const named = /^schema\/([a-z-]+)\/(.+?)(?:\.toml)?$/.exec(problem.file)
    if (!named) return undefined
    const [, dir, alias] = named as unknown as [string, string, string]
    return files.find((f) => f.dir === dir && f.definition?.alias === alias)
  }

  const out: LocatedProblem[] = []
  for (const problem of problems) {
    const found = fileOf(problem)
    if (
      found?.data !== undefined &&
      claimed.some((alias) => problem.message.includes(`"${alias}"`))
    )
      continue
    if (!found) {
      const definition = unwritten(problem.file)
      out.push({ ...problem, ...(definition ? { definition } : {}) })
      continue
    }
    const header = headerOf(found.dir)
    const part = found.definition ? partOf(found.data, header, problem.path) : undefined
    const key = keyOf(problem.path, header)
    const line = problem.line ?? lineOf(found.text, header, problem.path)
    out.push({
      ...problem,
      file: found.file,
      ...(found.definition ? { definition: found.definition } : {}),
      ...(part ? { part } : {}),
      ...(key ? { key } : {}),
      ...(line !== undefined ? { line } : {}),
    })
  }
  return out
}
