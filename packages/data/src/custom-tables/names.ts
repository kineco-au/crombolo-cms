/**
 * The names custom tables live under (story 189): each owner's schema, role and
 * file, and the rules for the names an owner writes. docs/data-model.md,
 * "Custom tables".
 *
 * An owner is the site, or a bundle that declares tables, by its id. On
 * Postgres each owner has a schema of its own, owned by a login-less role whose
 * name is unique to the database (decision 11); on SQLite, a file of its own.
 */
import { basename, dirname, join } from 'node:path'

/** Postgres truncates a longer identifier silently, so a longer one is refused. */
export const MAX_IDENTIFIER = 63

/** The site's own tables are ledgered under this, as a bundle's are under its id. */
export const SITE_OWNER = 'site'

/** Table and column names, as an owner writes them. */
export const LOGICAL_NAME = /^[a-z][a-z0-9_]*$/

const underscored = (id: string): string => id.replaceAll('-', '_')

/** The owner's Postgres schema: `site`, or `bundle_<id>` with the id's hyphens as underscores. */
export function schemaName(owner: string): string {
  return owner === SITE_OWNER ? SITE_OWNER : `bundle_${underscored(owner)}`
}

/** `siteName` as a role name's first part: lowercased, letters and digits, at most 13. */
export function siteSlug(siteName: string): string {
  const slug = siteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 13)
    .replace(/_+$/, '')
  return slug === '' ? 'site' : slug
}

/** The first 8 hex characters of a hash of the database's name. */
export function databaseHash(database: string): string {
  return new Bun.CryptoHasher('sha256').update(database).digest('hex').slice(0, 8)
}

/**
 * The owner's role: `{site}_{hash}` for the site, `{site}_{bundle id}_{hash}`
 * for a bundle. At most 62 characters: 13, the longest bundle id (39), 8 and
 * two separators.
 */
export function roleName(siteName: string, owner: string, database: string): string {
  const parts = [siteSlug(siteName)]
  if (owner !== SITE_OWNER) parts.push(underscored(owner))
  parts.push(databaseHash(database))
  return parts.join('_')
}

/** What a role's comment says, so a role made for another database is never taken. */
export const roleComment = (database: string): string => `crombolo custom tables for ${database}`

/**
 * The owner's SQLite file, beside crombolo's own: `crombolo.sqlite` gives
 * `crombolo.site.sqlite` and `crombolo.bundle.<id>.sqlite`. In memory, in memory.
 */
export function ownerFile(mainFile: string, owner: string): string {
  if (mainFile === ':memory:') return ':memory:'
  const stem = basename(mainFile).replace(/\.(sqlite3?|db)$/i, '')
  const middle = owner === SITE_OWNER ? SITE_OWNER : `bundle.${owner}`
  return join(dirname(mainFile), `${stem}.${middle}.sqlite`)
}

/**
 * An index's name, generated rather than chosen, from what it covers. The
 * `ix_` it starts with is a namespace a table may not enter, because Postgres
 * keeps a schema's tables and indexes in one.
 */
export function indexName(table: string, columns: readonly string[]): string {
  const hash = new Bun.CryptoHasher('sha256').update(`${table}(${columns.join(',')})`).digest('hex')
  return `ix_${hash.slice(0, 12)}`
}

/** Why a table or column name is not allowed, or undefined when it is. */
export function logicalNameProblem(kind: 'table' | 'column', name: string): string | undefined {
  if (typeof name !== 'string' || !LOGICAL_NAME.test(name))
    return `the ${kind} name "${String(name)}" is not lowercase letters, digits and underscores starting with a letter`
  if (kind === 'table' && name.startsWith('ix_'))
    return `the table name "${name}" starts with "ix_", which index names use`
  return lengthProblem(name)
}

/** Why a name is too long for Postgres, or undefined when it fits. */
export function lengthProblem(name: string): string | undefined {
  return name.length > MAX_IDENTIFIER
    ? `"${name}" is ${name.length} characters, past the ${MAX_IDENTIFIER} Postgres keeps`
    : undefined
}
