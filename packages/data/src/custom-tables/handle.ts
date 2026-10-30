/**
 * The Kysely handle on an owner's tables (story 189): what a named query's `db`
 * and a bundle's `context.bundle.database` are. It runs on the owner's own
 * connection, so it reaches nothing else, and converts values so the same code
 * reads and writes the same on both engines (`values.ts`).
 *
 * `db.transaction().execute(async (trx) => …)` is Kysely's own: here it holds
 * one transaction on the owner's connection until the callback settles.
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
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely'
import type { Db } from '../database.ts'
import { PlaceholderCompiler, readsRows } from '../query.ts'
import type { KyselyTablesOf, TablesShape } from './builder.ts'
import type { CustomTables, ResolvedSchema } from './schema.ts'
import { PortableValues, portableParam } from './values.ts'

/** A handle on an owner's tables, typed from its steps. */
export type TablesDatabase<T extends CustomTables = CustomTables> =
  T extends CustomTables<infer S> ? Kysely<KyselyTablesOf<S>> : never

/** A handle typed from a shape, for one declared by hand after a SQL step. */
export type ShapeDatabase<S extends TablesShape> = Kysely<KyselyTablesOf<S>>

const ROLLBACK = Symbol('rollback')

/**
 * One acquisition of the owner's connection. Outside a transaction each
 * statement stands alone; inside one, the statements share the `Db`
 * transaction opened at `begin` and held open until `commit` or `rollback`.
 */
class OwnerConnection implements DatabaseConnection {
  readonly #db: Db
  #tx: Db | undefined
  #settle: ((commit: boolean) => void) | undefined
  #done: Promise<void> | undefined

  constructor(db: Db) {
    this.#db = db
  }

  async begin(): Promise<void> {
    let opened!: (tx: Db) => void
    const ready = new Promise<Db>((resolve) => {
      opened = resolve
    })
    this.#done = this.#db
      .transaction(
        (tx) =>
          new Promise<void>((resolve, reject) => {
            this.#settle = (commit) => (commit ? resolve() : reject(ROLLBACK))
            opened(tx)
          }),
      )
      .catch((error: unknown) => {
        if (error !== ROLLBACK) throw error
      })
    this.#tx = await Promise.race([
      ready,
      this.#done.then(() => {
        throw new Error('The transaction ended before it began.')
      }),
    ])
  }

  async end(commit: boolean): Promise<void> {
    this.#settle?.(commit)
    try {
      await this.#done
    } finally {
      this.#tx = undefined
      this.#settle = undefined
      this.#done = undefined
    }
  }

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const db = this.#tx ?? this.#db
    const params = (compiled.parameters as unknown[]).map((value) =>
      portableParam(db.dialect, value),
    )
    if (readsRows(compiled)) return { rows: await db.query<R>(compiled.sql, params) }
    await db.exec(compiled.sql, params)
    return { rows: [] }
  }

  // biome-ignore lint/correctness/useYield: refuses before streaming anything
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Streaming is not supported; page with limit and offset instead.')
  }
}

class OwnerDriver implements Driver {
  readonly #db: Db
  constructor(db: Db) {
    this.#db = db
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return new OwnerConnection(this.#db)
  }
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as OwnerConnection).begin()
  }
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as OwnerConnection).end(true)
  }
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as OwnerConnection).end(false)
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

/** The handle on an owner's tables, over the connection that reaches only them. */
export function tablesDatabase<S extends TablesShape = TablesShape>(
  db: Db,
  schema: ResolvedSchema,
): Kysely<KyselyTablesOf<S>> {
  const postgres = db.dialect.name === 'postgres'
  const dialect: KyselyDialect = {
    createAdapter: () => (postgres ? new PostgresAdapter() : new SqliteAdapter()),
    createDriver: () => new OwnerDriver(db),
    createQueryCompiler: () => (postgres ? new PlaceholderCompiler() : new SqliteQueryCompiler()),
    createIntrospector: (k: Kysely<unknown>): DatabaseIntrospector =>
      postgres ? new PostgresIntrospector(k) : new SqliteIntrospector(k),
  }
  return new Kysely<KyselyTablesOf<S>>({ dialect, plugins: [new PortableValues(schema)] })
}
