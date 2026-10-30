/**
 * Where an owner's tables live, and the connection that reaches only them
 * (story 189). docs/data-model.md, "Custom tables".
 *
 * - **Postgres:** the owner's schema, owned by a login-less role granted to the
 *   CMS's own. Every transaction on the owner's handle begins `SET LOCAL ROLE`,
 *   so the role drops back at commit, and the role has no privilege on
 *   crombolo's tables or another owner's.
 * - **SQLite:** a file of the owner's own, on a connection of its own, with
 *   crombolo's database and the other owners' files never attached.
 */
import { type Kysely, sql } from 'kysely'
import { connect, type Db } from '../database.ts'
import { Locks } from '../locks.ts'
import { deleteKeyValue, readKeyValue, writeKeyValue } from '../migrations.ts'
import { queryFor } from '../query.ts'
import { ownerFile, roleComment, roleName, schemaName } from './names.ts'

/** Where one owner's tables are. */
export interface OwnerPlace {
  /** `site`, or the bundle's id. */
  id: string
  dialect: Db['dialect']['name']
  /** Postgres: the schema and the role that owns it. */
  schema: string
  role?: string
  /** SQLite: the file. */
  file?: string
}

/** What naming an owner's place needs from the site. */
export interface OwnerSettings {
  siteName: string
  /** crombolo's own SQLite file, which an owner's sits beside. */
  sqliteFile: string
}

const roleKey = (owner: string): string => `Crombolo.Tables.${owner}.Role`

/**
 * The CMS may not create the owner's role or schema itself: the SQL for an
 * operator to run once, after which boot checks what it made.
 */
export class OwnerSetupNeededError extends Error {
  constructor(
    readonly owner: string,
    readonly reason: string,
    readonly statements: string[],
  ) {
    super(
      `The ${owner === 'site' ? "site's own tables" : `bundle "${owner}"'s tables`} need a database role and schema, and ${reason}. ` +
        `Run this once as a role that may, then start again:\n\n${statements.join('\n')}\n`,
    )
  }
}

/** The role exists, made for another database: taking it would share it. */
export class OwnerRoleTakenError extends Error {
  constructor(
    readonly role: string,
    readonly comment: string | null,
  ) {
    super(
      `The database role "${role}" already exists ${comment ? `("${comment}")` : 'without a crombolo comment'}, and was not made for this database. ` +
        'Two databases cannot share a role: rename the site, or drop the role if nothing uses it.',
    )
  }
}

/** The schema exists and belongs to a role other than the owner's. */
export class OwnerSchemaTakenError extends Error {
  constructor(
    readonly schema: string,
    readonly role: string,
    readonly holder: string,
  ) {
    super(
      `The schema "${schema}" already exists and belongs to "${holder}", not "${role}". Move it aside, or give it to "${role}".`,
    )
  }
}

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`

/** The statements that make an owner's role and schema, as an operator would run them. */
export function ownerSetupStatements(
  db: Db,
  place: { role: string; schema: string },
  database: string,
  grantee: string,
): string[] {
  const q = (id: string) => db.dialect.quote(id)
  return [
    `CREATE ROLE ${q(place.role)} NOLOGIN;`,
    `COMMENT ON ROLE ${q(place.role)} IS ${literal(roleComment(database))};`,
    `GRANT ${q(place.role)} TO ${q(grantee)};`,
    `CREATE SCHEMA IF NOT EXISTS ${q(place.schema)} AUTHORIZATION ${q(place.role)};`,
  ]
}

interface Catalogue {
  database: string
  user: string
  mayCreateRoles: boolean
  /** `SET` from 16, where membership alone no longer lets a role be taken. */
  membership: 'SET' | 'MEMBER'
}

/** Postgres's catalogue, which is not crombolo's tables. */
interface PgCatalogue {
  pg_roles: { oid: number; rolname: string; rolcreaterole: boolean; rolsuper: boolean }
  pg_namespace: { nspname: string; nspowner: number }
}

const catalogueOf = (db: Db) => db.q as unknown as Kysely<PgCatalogue>

async function catalogue(db: Db): Promise<Catalogue> {
  const row = await db.q
    .selectNoFrom([
      sql<string>`current_database()`.as('database'),
      sql<string>`current_user`.as('user'),
      sql<number>`current_setting('server_version_num')::int`.as('version'),
    ])
    .executeTakeFirstOrThrow()
  const self = await catalogueOf(db)
    .selectFrom('pg_roles')
    .select(['rolcreaterole', 'rolsuper'])
    .where('rolname', '=', row.user)
    .executeTakeFirst()
  return {
    database: row.database,
    user: row.user,
    mayCreateRoles: self?.rolcreaterole === true || self?.rolsuper === true,
    membership: Number(row.version) >= 160000 ? 'SET' : 'MEMBER',
  }
}

async function roleOf(db: Db, role: string) {
  return catalogueOf(db)
    .selectFrom('pg_roles')
    .select(['rolname', sql<string | null>`shobj_description(oid, 'pg_authid')`.as('comment')])
    .where('rolname', '=', role)
    .executeTakeFirst()
}

async function schemaHolder(db: Db, schema: string): Promise<string | undefined> {
  const row = await catalogueOf(db)
    .selectFrom('pg_namespace')
    .select(sql<string>`nspowner::regrole::text`.as('holder'))
    .where('nspname', '=', schema)
    .executeTakeFirst()
  return row ? String(row.holder).replace(/^"|"$/g, '') : undefined
}

/**
 * Makes sure the owner's place exists and is the owner's, creating what the CMS
 * may, and records its role's name so renaming the site moves nothing.
 */
export async function provisionOwner(
  db: Db,
  settings: OwnerSettings,
  owner: string,
): Promise<OwnerPlace> {
  const schema = schemaName(owner)
  if (db.dialect.name === 'sqlite')
    return { id: owner, dialect: 'sqlite', schema, file: ownerFile(settings.sqliteFile, owner) }

  return db.locks.withLock(Locks.KeyValues, async () => {
    const found = await catalogue(db)
    const role =
      (await readKeyValue(db, roleKey(owner))) ?? roleName(settings.siteName, owner, found.database)
    const place = { role, schema }
    const statements = ownerSetupStatements(db, place, found.database, found.user)
    const q = (id: string) => db.dialect.quote(id)
    const k = queryFor(db)

    const existing = await roleOf(db, role)
    if (existing && existing.comment !== roleComment(found.database))
      throw new OwnerRoleTakenError(role, existing.comment)
    if (!existing) {
      if (!found.mayCreateRoles)
        throw new OwnerSetupNeededError(
          owner,
          'this database user may not create roles',
          statements,
        )
      await sql.raw(`CREATE ROLE ${q(role)} NOLOGIN`).execute(k)
      await sql
        .raw(`COMMENT ON ROLE ${q(role)} IS ${literal(roleComment(found.database))}`)
        .execute(k)
    }
    const member = await k
      .selectNoFrom(
        sql<boolean>`pg_has_role(current_user, ${role}, ${found.membership})`.as('member'),
      )
      .executeTakeFirstOrThrow()
    if (!member.member) {
      if (!found.mayCreateRoles)
        throw new OwnerSetupNeededError(
          owner,
          `"${found.user}" is not granted its role`,
          statements,
        )
      await sql.raw(`GRANT ${q(role)} TO ${q(found.user)}`).execute(k)
    }

    const holder = await schemaHolder(db, schema)
    if (holder === undefined) {
      try {
        await sql.raw(`CREATE SCHEMA ${q(schema)} AUTHORIZATION ${q(role)}`).execute(k)
      } catch (error) {
        throw new OwnerSetupNeededError(
          owner,
          `the schema could not be created (${error instanceof Error ? error.message : String(error)})`,
          statements,
        )
      }
    } else if (holder !== role) throw new OwnerSchemaTakenError(schema, role, holder)

    await writeKeyValue(db, roleKey(owner), role)
    return { id: owner, dialect: 'postgres', schema, role }
  })
}

/** An owner's place as recorded, for a node that does not provision: undefined when it never was. */
export async function recordedOwner(
  db: Db,
  settings: OwnerSettings,
  owner: string,
): Promise<OwnerPlace | undefined> {
  const schema = schemaName(owner)
  if (db.dialect.name === 'sqlite')
    return { id: owner, dialect: 'sqlite', schema, file: ownerFile(settings.sqliteFile, owner) }
  const role = await readKeyValue(db, roleKey(owner))
  return role ? { id: owner, dialect: 'postgres', schema, role } : undefined
}

/** Forgets an owner's recorded role, once its schema is gone. */
export async function forgetOwner(db: Db, owner: string): Promise<void> {
  await deleteKeyValue(db, roleKey(owner))
}

const memory = new WeakMap<Db, Map<string, Db>>()

/**
 * The connection that reaches only the owner's tables. On SQLite in memory the
 * owner's database lives as long as crombolo's, so it is kept per handle.
 */
export async function openOwner(db: Db, place: OwnerPlace): Promise<Db> {
  if (db.dialect.name === 'postgres') {
    if (!db.confine || !place.role) throw new Error(`No role is recorded for "${place.id}".`)
    return db.confine(place.role, place.schema)
  }
  const file = place.file ?? ':memory:'
  if (file !== ':memory:') return connect({ dialect: 'sqlite', file })
  let owners = memory.get(db)
  if (!owners) {
    owners = new Map()
    memory.set(db, owners)
  }
  let owned = owners.get(place.id)
  if (!owned) {
    owned = await connect({ dialect: 'sqlite', file: ':memory:' })
    owners.set(place.id, owned)
  }
  return owned
}

/**
 * Runs `fn` against the owner's tables, as part of `main`'s transaction where
 * the engine allows: on Postgres the transaction takes the owner's role and
 * search path for `fn` and gives them back, so a step and its ledger row commit
 * together. A SQLite file has a transaction of its own, committed just before
 * crombolo's.
 */
export async function asOwner<T>(
  main: Db,
  place: OwnerPlace,
  owned: Db | undefined,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  if (main.dialect.name === 'sqlite') {
    if (!owned) throw new Error(`No connection is open to "${place.id}"'s tables.`)
    return owned.transaction(fn)
  }
  if (!place.role) throw new Error(`No role is recorded for "${place.id}".`)
  const k = queryFor(main)
  const { path } = await k
    .selectNoFrom(sql<string>`current_setting('search_path')`.as('path'))
    .executeTakeFirstOrThrow()
  const q = (id: string) => main.dialect.quote(id)
  await main.exec(`SET LOCAL ROLE ${q(place.role)}`)
  await main.exec(`SET LOCAL search_path TO ${q(place.schema)}`)
  // On a failure the transaction is rolled back, role and path with it.
  const result = await fn(main)
  await main.exec('SET LOCAL ROLE NONE')
  await k.selectNoFrom(sql`set_config('search_path', ${path}, true)`.as('set')).execute()
  return result
}
