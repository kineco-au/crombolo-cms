/**
 * Schema operations on the dialect seam, so a migration is written once.
 * Bun's SQLite is recent enough for `ALTER TABLE … DROP COLUMN` and
 * `RENAME COLUMN`, so nothing here needs the copy-table dance.
 */
import type { Db } from './database.ts'
import { sql } from './query.ts'

export interface SchemaOps {
  addColumn(table: string, column: string, definition: string): Promise<void>
  dropColumn(table: string, column: string): Promise<void>
  renameColumn(table: string, from: string, to: string): Promise<void>
  renameTable(from: string, to: string): Promise<void>
  addIndex(name: string, table: string, columns: readonly string[], unique?: boolean): Promise<void>
  dropIndex(name: string, table: string): Promise<void>
  dropTable(table: string): Promise<void>
}

export function schemaOps(db: Db): SchemaOps {
  const schema = db.q.schema
  return {
    addColumn: (table, column, definition) =>
      schema.alterTable(table).addColumn(column, sql.raw(definition)).execute(),
    dropColumn: (table, column) => schema.alterTable(table).dropColumn(column).execute(),
    renameColumn: (table, from, to) => schema.alterTable(table).renameColumn(from, to).execute(),
    renameTable: (from, to) => schema.alterTable(from).renameTo(to).execute(),
    addIndex: (name, table, columns, unique = false) => {
      const index = schema
        .createIndex(name)
        .on(table)
        .columns([...columns])
      return (unique ? index.unique() : index).execute()
    },
    // Postgres drops an index by name alone; SQLite too. `table` documents intent.
    dropIndex: (name) => schema.dropIndex(name).execute(),
    dropTable: (table) => schema.dropTable(table).execute(),
  }
}
