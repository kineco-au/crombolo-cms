/**
 * Holding a query to its plan rather than a stopwatch (stories 197, 246): the
 * statements a call makes, and whether the planner would scan a large table
 * whole to answer one.
 */
import { type Db, queryFor } from '@crombolo/data'

/** Every statement `run` makes, with its parameters. */
export async function statementsOf(db: Db, run: (db: Db) => Promise<unknown>) {
  const seen: Array<{ sql: string; params: unknown[] }> = []
  const watched: Db = {
    ...db,
    get q() {
      return queryFor(this)
    },
    query: (sql, params) => {
      seen.push({ sql, params: params ?? [] })
      return db.query(sql, params)
    },
    exec: (sql, params) => db.exec(sql, params),
    transaction: (fn) => db.transaction(fn),
    readSnapshot: (fn) => db.readSnapshot(fn),
  }
  await run(watched)
  return seen
}

/**
 * What the planner would do: a whole-table scan of a large table is the failure.
 * With `indexable`, Postgres is asked with sequential scans off, so what is left is
 * a scan no index could replace: a generated library that is most of `node` makes
 * a scan the cheaper plan, which says nothing about a site whose folder is not.
 */
export async function fullScans(
  db: Db,
  sql: string,
  params: unknown[],
  options: { indexable?: boolean } = {},
): Promise<string[]> {
  if (db.dialect.name === 'postgres') {
    const plan = options.indexable
      ? await db.transaction(async (tx) => {
          await tx.exec('SET LOCAL enable_seqscan = off')
          return tx.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params)
        })
      : await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params)
    return plan
      .map((row) => String(Object.values(row)[0]))
      .filter((line) =>
        /Seq Scan on (node|content|content_version|document_version|property_value)\b/.test(line),
      )
  }
  const plan = await db.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
  return plan
    .map((row) => String(row.detail))
    .filter((detail) =>
      /^SCAN (n|an|c|pc|pd|head|hv|cv|pv|v|node|content|content_version|document_version|property_value)\b/.test(
        detail,
      ),
    )
}
