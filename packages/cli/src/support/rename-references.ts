/**
 * Where a site's content files and views name a type or a property (story 250),
 * and how a rename rewrites them. A content file is rewritten in place, one
 * occurrence at a time, and kept only when it reads back as exactly the
 * renamed content; a view is rewritten only where a known pattern says what
 * it names. Anything that cannot be rewritten that way is said, not guessed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { allProperties, type SchemaSet, type SchemaTypeKind } from '@crombolo/schema'
import type { CromboloConfig } from '@crombolo/server'

export type Rename =
  | { what: 'type'; kind: SchemaTypeKind; from: string; to: string }
  | { what: 'property'; kind: SchemaTypeKind; type: string; from: string; to: string }
  | { what: 'data'; from: string; to: string }

/** One place outside the definitions that names what is renamed. */
export interface SiteReference {
  /** `page /home/news`, `view components/pages/article.tsx`. */
  in: string
  how: string
  /** Rewritten as part of the rename; otherwise it cannot be, and why. */
  rewrite: { file: string; next: string } | { unsafe: string }
}

export interface SiteReferences {
  references: SiteReference[]
  /** Places that may name it and are left as they are: said, so a person can look. */
  notes: string[]
}

type Data = Record<string, unknown>
const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const CONTENT_DIRS = [
  { dir: 'pages', noun: 'page', kinds: ['document'] },
  { dir: 'library', noun: 'library item', kinds: ['document'] },
  { dir: 'media', noun: 'media item', kinds: ['media'] },
] as const

const LANGUAGE = /^[a-z]{2}(-[a-z]{2,4})?$/i

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => extensions.some((ext) => name.endsWith(ext)))
    .map((name) => join(dir, name))
    .filter((file) => statSync(file).isFile())
    .sort()
}

/** A content file's data as the rename should leave it: each place that names the old alias. */
function renamedData(data: Data, rename: Rename, top: boolean): Data {
  const out: Data = { ...data }
  const typed = typeof data.type === 'string' ? data.type : undefined
  if (rename.what === 'type' && typed === rename.from && (top || rename.kind === 'document'))
    out.type = rename.to
  const renameIn = (values: Data): Data =>
    Object.fromEntries(
      Object.entries(values).map(([alias, value]) => [
        alias === rename.from ? rename.to : alias,
        value,
      ]),
    )
  if (isRecord(data.values)) {
    let values = data.values
    if (rename.what === 'property' && typed === rename.type) {
      values = renameIn(values)
      // A page's values in a language are a table of their own: `[values.en-US]`.
      if (top)
        values = Object.fromEntries(
          Object.entries(values).map(([alias, value]) => [
            alias,
            LANGUAGE.test(alias) && isRecord(value) ? renameIn(value) : value,
          ]),
        )
    }
    out.values = blocksRenamed(values, rename)
  }
  if (!top && isRecord(data.settings)) out.settings = renamedData(data.settings, rename, false)
  return out
}

/** Blocks anywhere among the values: `{ type = "…", values = { … } }` in a list. */
function blocksRenamed(value: unknown, rename: Rename): never {
  if (Array.isArray(value))
    return value.map((item) =>
      isRecord(item) && typeof item.type === 'string'
        ? renamedData(item, rename, false)
        : blocksRenamed(item, rename),
    ) as never
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, blocksRenamed(v, rename)]),
    ) as never
  return value as never
}

/** The paths where two parsed files differ, as `a.b.c`. */
function differences(a: unknown, b: unknown, path = ''): string[] {
  if (isRecord(a) && isRecord(b))
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      key in a && key in b ? differences(a[key], b[key], `${path}.${key}`) : [`${path}.${key}`],
    )
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    return a.flatMap((item, i) => differences(item, b[i], `${path}[${i}]`))
  return isDeepStrictEqual(a, b) ? [] : [path]
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Each place in the text that might be the old alias, with what it would become. */
function candidates(
  text: string,
  rename: Rename,
): Array<{ at: number; old: string; next: string }> {
  const from = escapeRegExp(rename.from)
  const pattern =
    rename.what === 'type'
      ? new RegExp(`(\\btype\\s*=\\s*)(["'])${from}\\2`, 'g')
      : new RegExp(`(^|[\\s{,.\\[])(["']?)${from}\\2(?=\\s*[=\\]])`, 'gm')
  return [...text.matchAll(pattern)].map((match) => {
    const [whole, before, quote] = match as unknown as [string, string, string]
    return { at: match.index, old: whole, next: `${before}${quote}${rename.to}${quote}` }
  })
}

const applied = (text: string, chosen: ReadonlyArray<{ at: number; old: string; next: string }>) =>
  [...chosen]
    .sort((a, b) => b.at - a.at)
    .reduce((out, c) => out.slice(0, c.at) + c.next + out.slice(c.at + c.old.length), text)

const parsed = (text: string): unknown => {
  try {
    return Bun.TOML.parse(text)
  } catch {
    return undefined
  }
}

/**
 * A content file rewritten for a rename: each occurrence kept only when it is
 * one the rename moves, and the whole kept only when it reads back as exactly
 * the renamed content. Undefined when the file does not name it.
 */
export function rewriteContentFile(
  text: string,
  rename: Rename,
): { next: string } | { unsafe: string } | undefined {
  const data = parsed(text)
  if (!isRecord(data)) return undefined
  const expected = renamedData(data, rename, true)
  if (isDeepStrictEqual(data, expected)) return undefined
  const wanted = new Set(differences(data, expected))
  const chosen = candidates(text, rename).filter((c) => {
    const changed = differences(data, parsed(applied(text, [c])))
    return changed.length > 0 && changed.every((path) => wanted.has(path))
  })
  const next = applied(text, chosen)
  return isDeepStrictEqual(parsed(next), expected)
    ? { next }
    : { unsafe: 'it is written in a way the rename cannot change safely' }
}

/** The places the site's content files name what is renamed. */
function contentReferences(config: CromboloConfig, rename: Rename): SiteReference[] {
  if (rename.what === 'data') return []
  return CONTENT_DIRS.flatMap(({ dir, noun, kinds }) => {
    if (!(kinds as readonly string[]).includes(rename.kind)) return []
    const root = join(config.siteDir, 'content', dir)
    return filesUnder(root, ['.toml']).flatMap((file): SiteReference[] => {
      const rewrite = rewriteContentFile(readFileSync(file, 'utf8'), rename)
      if (!rewrite) return []
      const path = relative(root, file).replace(/\.toml$/, '')
      return [
        {
          in: `${noun} /${path}`,
          how: rename.what === 'type' ? 'its type' : 'a value',
          rewrite: 'next' in rewrite ? { file, next: rewrite.next } : rewrite,
        },
      ]
    })
  })
}

const VIEW_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']
const PROPERTY_CALL = '\\.(?:value|text|html|media|hasValue|getProperty)\\(\\s*'
const TYPE_TEST = '(?:contentType\\.alias|contentTypeAlias)\\s*[!=]==?\\s*'

const pascal = (alias: string) => alias.charAt(0).toUpperCase() + alias.slice(1)

/** Whether a property alias is this type's alone, so a view naming it can only mean it. */
function onlyOn(set: SchemaSet, rename: Extract<Rename, { what: 'property' }>): boolean {
  const all = [...set.contentTypes, ...(set.mediaTypes ?? []), ...(set.memberTypes ?? [])]
  const owner = all.find((t) => t.alias === rename.type)
  // A composition's property is the same one on every type composed of it.
  const sharing = new Set([rename.type, ...(owner?.compositions ?? [])])
  for (const t of all) if (t.compositions.includes(rename.type)) sharing.add(t.alias)
  return !all.some(
    (t) => !sharing.has(t.alias) && allProperties(t).some((p) => p.alias === rename.from),
  )
}

/** The places the site's views name what is renamed, and the strings that only might. */
function viewReferences(config: CromboloConfig, set: SchemaSet, rename: Rename): SiteReferences {
  if (rename.what === 'data') return { references: [], notes: [] }
  const from = escapeRegExp(rename.from)
  const quoted = `(["'\`])${from}\\1`
  const definite =
    rename.what === 'type'
      ? [
          new RegExp(`(?:${TYPE_TEST})${quoted}`, 'g'),
          new RegExp(`${quoted}(?:\\s*[!=]==?\\s*(?:contentType\\.alias|contentTypeAlias))`, 'g'),
        ]
      : [new RegExp(`(?:${PROPERTY_CALL})${quoted}`, 'g')]
  const certain = rename.what === 'type' || onlyOn(set, rename)
  const references: SiteReference[] = []
  const notes: string[] = []
  const roots = [config.componentsDir, join(config.siteDir, 'actions')]
  for (const file of roots.flatMap((root) => filesUnder(root, VIEW_EXTENSIONS))) {
    const text = readFileSync(file, 'utf8')
    const shown = relative(config.siteDir, file)
    let next = text
    let named = 0
    for (const pattern of definite)
      next = next.replace(pattern, (whole: string) => {
        named++
        return whole.replace(new RegExp(`(["'\`])${from}\\1`), `$1${rename.to}$1`)
      })
    // The generated model's interface for the type, in a view that uses it.
    if (rename.what === 'type' && /content-types(\.d)?(\.ts)?['"]/.test(text)) {
      const name = new RegExp(`\\b${escapeRegExp(pascal(rename.from))}\\b`, 'g')
      next = next.replace(name, () => {
        named++
        return pascal(rename.to)
      })
    }
    const left = [...next.matchAll(new RegExp(quoted, 'g'))].length
    if (named > 0) {
      const how = rename.what === 'type' ? 'tests for it' : 'reads it'
      references.push({
        in: `view ${shown}`,
        how,
        rewrite: certain
          ? { file, next }
          : {
              unsafe: `"${rename.from}" is a property of other types too, so the view may mean one of theirs`,
            },
      })
    }
    if (left > 0)
      notes.push(
        `${shown} also says "${rename.from}" ${left === 1 ? 'once' : `${left} times`}: check it, it is left as it is`,
      )
  }
  return { references, notes }
}

/** Every place outside the definitions that names what is renamed. */
export function siteReferences(
  config: CromboloConfig,
  set: SchemaSet,
  rename: Rename,
): SiteReferences {
  const views = viewReferences(config, set, rename)
  return {
    references: [...contentReferences(config, rename), ...views.references],
    notes: views.notes,
  }
}

/** Where a type is used outside the definitions, for `types show`: its content files and views. */
export function typeUses(
  config: CromboloConfig,
  set: SchemaSet,
  kind: SchemaTypeKind,
  alias: string,
): { contentFiles: string[]; views: string[] } {
  // Found as a rename would find them; the new alias is never written.
  const as = (rename: Rename) => siteReferences(config, set, rename).references
  const contentFiles = contentReferences(config, {
    what: 'type',
    kind,
    from: alias,
    to: `${alias}_`,
  })
  const views = new Map<string, string[]>()
  const add = (where: string, what: string) => views.set(where, [...(views.get(where) ?? []), what])
  for (const r of viewReferences(config, set, { what: 'type', kind, from: alias, to: `${alias}_` })
    .references)
    add(r.in.replace(/^view /, ''), 'tests for it')
  const type = [...set.contentTypes, ...(set.mediaTypes ?? []), ...(set.memberTypes ?? [])].find(
    (t) => t.alias === alias,
  )
  for (const p of type ? allProperties(type) : [])
    for (const r of as({ what: 'property', kind, type: alias, from: p.alias, to: `${p.alias}_` }))
      if (r.in.startsWith('view ') && 'file' in r.rewrite)
        add(r.in.replace(/^view /, ''), `reads ${p.alias}`)
  return {
    contentFiles: contentFiles.map((r) => r.in),
    views: [...views].map(([where, what]) => `${where}: ${what.join(', ')}`),
  }
}
