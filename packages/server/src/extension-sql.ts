/**
 * What the CMS will run of an extension's queries (story 311): one statement
 * that reads or writes rows, and nothing that leaves its own tables. The
 * connection is already confined to them; this refuses what could undo that:
 * `ATTACH` on SQLite, a role change on Postgres, or a second statement.
 * docs/extensions.md, "Its own tables".
 */

const ALLOWED_FIRST = new Set(['select', 'insert', 'update', 'delete', 'with', 'values', 'replace'])

/** Words that never appear in a query an extension needs, whatever they are part of. */
const REFUSED = new Set([
  'attach',
  'detach',
  'pragma',
  'vacuum',
  'load_extension',
  'set_config',
  'dblink',
  'dblink_exec',
  'lo_import',
  'lo_export',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'copy',
])

/** The SQL with its comments, strings and quoted names taken out, so only its words are left. */
function words(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i] as string
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
    } else if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < sql.length) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) i += 2
          else break
        } else i++
      }
      i++
      out += c === "'" ? " '' " : ' _q_ '
    } else if (c === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        i = end === -1 ? sql.length : end + tag[0].length
        out += " '' "
      } else {
        out += c
        i++
      }
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Why the CMS will not run this for an extension, or undefined when it will. Pure. */
export function extensionSqlProblem(
  sql: string,
  _dialect: 'sqlite' | 'postgres',
): string | undefined {
  const bare = words(sql).trim().replace(/;\s*$/, '')
  if (bare.includes(';')) return 'An extension may run one statement at a time.'
  const tokens = bare.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []
  const first = tokens[0]
  if (!first || !ALLOWED_FIRST.has(first))
    return `An extension may read and write rows of its own tables, not run ${first ? first.toUpperCase() : 'that'}.`
  const refused = tokens.find((token) => REFUSED.has(token))
  if (refused) return `An extension's query may not use ${refused.toUpperCase()}.`
  return undefined
}
