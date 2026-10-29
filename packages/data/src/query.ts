/**
 * Kysely as the query builder over a `Db` (story 221): Kysely compiles, and the
 * `Db` runs what it compiles, so transactions, locks, snapshots and the dialect
 * seam stay exactly as they are. docs/data-model.md, "Building queries".
 */
import {
  type CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Driver,
  Kysely,
  type Dialect as KyselyDialect,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
  type RawBuilder,
  type SelectQueryBuilder,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  sql,
} from 'kysely'
import type { Db } from './database.ts'
import type { Dialect as DbDialect } from './dialect.ts'
import type { CoreTables } from './tables.gen.ts'

export type { Expression, Insertable, Selectable, Updateable } from 'kysely'
export { sql }

export type Query<Tables = CoreTables> = Kysely<Tables>

/**
 * Placeholders stay `?` on Postgres too: the `Db` renders them, as it does for
 * every statement, so a wrapped or recording `Db` sees Kysely's SQL as it would
 * any other.
 */
class PlaceholderCompiler extends PostgresQueryCompiler {
  protected override getCurrentParameterPlaceholder(): string {
    return '?'
  }
}

const READS = /^\s*(select|with|values|pragma|explain)\b/i
const RETURNS = /\breturning\b/i

/** Whether a statement answers with rows, so it runs as a query rather than an exec. */
function readsRows(compiled: CompiledQuery): boolean {
  const kind = compiled.query.kind
  if (kind === 'SelectQueryNode') return true
  if (kind === 'InsertQueryNode' || kind === 'UpdateQueryNode' || kind === 'DeleteQueryNode')
    return 'returning' in compiled.query && compiled.query.returning !== undefined
  return READS.test(compiled.sql) || RETURNS.test(compiled.sql)
}

class DbConnection implements DatabaseConnection {
  constructor(readonly db: Db) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const params = compiled.parameters as unknown[]
    if (readsRows(compiled)) return { rows: await this.db.query<R>(compiled.sql, params) }
    await this.db.exec(compiled.sql, params)
    return { rows: [] }
  }

  // biome-ignore lint/correctness/useYield: refuses before streaming anything
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Streaming is not supported; page with limit and offset instead.')
  }
}

export class TransactionRefused extends Error {
  constructor() {
    super('Open transactions with db.transaction(async (tx) => …) and build with tx.q.')
  }
}

class DbDriver implements Driver {
  readonly #connection: DbConnection
  constructor(db: Db) {
    this.#connection = new DbConnection(db)
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.#connection
  }
  async beginTransaction(): Promise<void> {
    throw new TransactionRefused()
  }
  async commitTransaction(): Promise<void> {
    throw new TransactionRefused()
  }
  async rollbackTransaction(): Promise<void> {
    throw new TransactionRefused()
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

function kyselyDialect(db: Db): KyselyDialect {
  const postgres = db.dialect.name === 'postgres'
  return {
    createAdapter: () => (postgres ? new PostgresAdapter() : new SqliteAdapter()),
    createDriver: () => new DbDriver(db),
    createQueryCompiler: () => (postgres ? new PlaceholderCompiler() : new SqliteQueryCompiler()),
    createIntrospector: (k: Kysely<unknown>): DatabaseIntrospector =>
      postgres ? new PostgresIntrospector(k) : new SqliteIntrospector(k),
  }
}

const built = new WeakMap<Db, Kysely<unknown>>()

/** The query builder over `db`, made once per `Db`; what `db.q` returns. */
export function queryFor<Tables = CoreTables>(db: Db): Kysely<Tables> {
  let k = built.get(db)
  if (!k) {
    k = new Kysely<unknown>({ dialect: kyselyDialect(db) })
    built.set(db, k)
  }
  return k as Kysely<Tables>
}

/** The database's clock, as the dialect writes it: what `dialect.now()` was spliced in as. */
export function now(db: Db): RawBuilder<string> {
  return sql<string>`${sql.raw(db.dialect.now())}`
}

export type RowLock = 'update' | 'share' | 'update skip locked'

/**
 * Locks the rows a select reads, where the engine can: Postgres. SQLite has a
 * single writer, so its select is left alone. Use as `.$call(rowLock(db, 'update'))`.
 */
// biome-ignore lint/suspicious/noExplicitAny: any select, whatever its tables and output
export function rowLock<Q extends SelectQueryBuilder<any, any, any>>(db: Db, mode: RowLock) {
  return (query: Q): Q => {
    if (db.dialect.name !== 'postgres') return query
    if (mode === 'share') return query.forShare() as Q
    if (mode === 'update') return query.forUpdate() as Q
    return query.forUpdate().skipLocked() as Q
  }
}

const compilers = new Map<string, Kysely<unknown>>()

/** A builder that only compiles, for statements rendered before there is a connection to run them. */
export function compilerFor<Tables = CoreTables>(dialect: DbDialect): Kysely<Tables> {
  let k = compilers.get(dialect.name)
  if (!k) {
    const refuse = async (): Promise<never> => {
      throw new Error('This builder only compiles; run what it compiles on a Db.')
    }
    const stub = { dialect, query: refuse, exec: refuse } as unknown as Db
    k = new Kysely<unknown>({ dialect: kyselyDialect(stub) })
    compilers.set(dialect.name, k)
  }
  return k as Kysely<Tables>
}
