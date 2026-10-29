/**
 * `bun run check:sql`: SQL is built with Kysely (story 221). Hand-written SQL
 * strings are allowed only in the drivers, the lock managers and the catalogue
 * reads of the type generator, behind the dialect seam, in released migrations
 * (history, never rewritten) and against a foreign database (an Umbraco
 * import's staging copy). Any other file holding one fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')

/** The schema files of the last release before 221: released migrations and the seeds they write. */
const RELEASED_SCHEMA = new Set(
  'approval-schedules approvals assistant audit-log built-in-content-types built-in-media-types built-in-member-types bundle-components bundle-package bundles-rename change-report client-id-prefix content-applied content-checkpoint content-editing content-events content-notifications content-seed content created-packages delivery-member-tokens diagnostics drop-assistant elements form-permission-prefix form-permissions form-workflows forms group-permissions identity log-viewer media-access media-cache media-member-grants media-member-uploads media-permissions member-property-type members plan property-searchable public-access recycle-bin redirects remote rich-text-ui search-index seed server-role since-version site-search transfer-answers transfer-run-package transfer-runs trashed-date two-factor upgrade-report users-localisation values webhooks'
    .split(' ')
    .map((name) => `packages/data/src/schema/${name}.ts`),
)

function allowed(file: string): boolean {
  return (
    file === 'packages/data/src/dialect.ts' ||
    file === 'packages/data/src/database.ts' ||
    file === 'packages/data/src/locks.ts' ||
    file === 'packages/data/src/table-types.ts' ||
    RELEASED_SCHEMA.has(file) ||
    file.startsWith('packages/import-umbraco/src/')
  )
}

const SQL =
  /\b(SELECT\s+(DISTINCT\s+)?[\w"*(]|INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+["\w]+\s+SET|DELETE\s+FROM|CREATE\s+(UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER|VIRTUAL)|ALTER\s+TABLE|DROP\s+(TABLE|INDEX|VIEW|TRIGGER)|PRAGMA\s+\w|ON\s+CONFLICT|RETURNING\s+[\w"*]|WHERE\s+[\w".]+\s*(=|<|>|IN\b|IS\b|LIKE\b)|ORDER\s+BY\s+[\w"]|GROUP\s+BY\s+[\w"]|(LEFT\s+|INNER\s+)?JOIN\s+\w+\s+\w+\s+ON\b)/

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.gen.ts') && !name.endsWith('.d.ts'))
      out.push(path)
  }
  return out
}

/**
 * The text of every string and template literal in a file, comments skipped. A
 * template's interpolations count as `?`, and the code inside them is scanned in
 * turn. TypeScript 7 has no JavaScript API to parse with, so this is a lexer.
 */
export function literals(source: string): string[] {
  const found: string[] = []
  let i = 0
  const n = source.length
  const quoted = (quote: string) => {
    let text = ''
    i++
    while (i < n && source[i] !== quote && source[i] !== '\n') {
      if (source[i] === '\\') {
        text += source[i + 1] ?? ''
        i += 2
      } else text += source[i++]
    }
    i++
    found.push(text)
  }
  const template = () => {
    let text = ''
    i++
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') {
        text += source[i + 1] ?? ''
        i += 2
      } else if (source[i] === '$' && source[i + 1] === '{') {
        i += 2
        text += '?'
        code('}')
        i++
      } else text += source[i++]
    }
    i++
    found.push(text)
  }
  /** A `/` starts a regular expression after an operator or keyword, and divides after a value. */
  const regexMayStart = () => {
    let j = i - 1
    while (j >= 0 && /\s/.test(source[j] as string)) j--
    if (j < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(source[j] as string)) return true
    return /\b(return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/.test(
      source.slice(Math.max(0, j - 10), j + 1),
    )
  }
  const regex = () => {
    i++
    let inClass = false
    while (i < n && source[i] !== '\n') {
      const c = source[i]
      if (c === '\\') i += 2
      else {
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) break
        i++
      }
    }
    i++
  }
  const code = (until?: string) => {
    let depth = 0
    while (i < n) {
      const c = source[i]
      if (until && c === until && depth === 0) return
      if (c === '{') depth++
      else if (c === '}') depth--
      if (c === '/' && source[i + 1] === '/') {
        while (i < n && source[i] !== '\n') i++
      } else if (c === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2)
        i = end < 0 ? n : end + 2
      } else if (c === '/' && regexMayStart()) regex()
      else if (c === "'" || c === '"') quoted(c)
      else if (c === '`') template()
      else i++
    }
  }
  code()
  return found
}

/** Files holding hand-written SQL outside the places it is allowed. */
export function filesWithSql(): string[] {
  const packages = join(ROOT, 'packages')
  const files: string[] = []
  for (const pkg of readdirSync(packages)) {
    const src = join(packages, pkg, 'src')
    try {
      if (!statSync(src).isDirectory()) continue
    } catch {
      continue
    }
    for (const path of sources(src)) {
      const file = relative(ROOT, path)
      if (allowed(file)) continue
      if (literals(readFileSync(path, 'utf8')).some((text) => SQL.test(text))) files.push(file)
    }
  }
  return files.sort()
}

if (import.meta.main) {
  const found = filesWithSql()
  for (const f of found) console.error(`${f}: build this SQL with Kysely (db.q) instead`)
  if (found.length > 0) process.exit(1)
  console.log('check:sql: no hand-written SQL')
}
