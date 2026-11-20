/**
 * Migration 085 — a workspace holds schema changes (story 376). Files are kept
 * once each, by the SHA-256 of their text (`file_blob`), and a workspace holds a
 * list of path and hash (`workspace_file`), taken when it opens: the hash then is
 * each file's merge base. A workspace's copy of a type or data type is a row of
 * its own, under a node and keys of its own, carrying `workspace_id` and the key
 * it stands for (`origin_key`); Shared's alias index is over Shared's rows only.
 *
 * The added columns have no foreign key: SQLite will not drop a column one names,
 * and every test rewind drops them.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_MERGE } from './workspace-merge.ts'

export const STATE_WORKSPACE_SCHEMA = '{7a3e9c51-0085-4b2d-8e6f-1c4a7b9d0085}'

/** The tables the migration adds, children first, for a rewind to drop. */
export const WORKSPACE_SCHEMA_TABLES = ['workspace_file', 'file_blob'] as const

/** The columns the migration adds, by table, for a rewind to drop. */
export const WORKSPACE_SCHEMA_COLUMNS: ReadonlyArray<{
  table: string
  columns: readonly string[]
}> = [
  { table: 'workspace', columns: ['schema_built'] },
  { table: 'content_type', columns: ['workspace_id', 'origin_key'] },
  { table: 'data_type', columns: ['workspace_id', 'origin_key'] },
  { table: 'property_type', columns: ['origin_key'] },
  { table: 'property_type_group', columns: ['origin_key'] },
]

export const workspaceSchemaMigration: Migration = {
  from: STATE_WORKSPACE_MERGE,
  to: STATE_WORKSPACE_SCHEMA,
  name: 'AddWorkspaceSchema',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('file_blob')
      .addColumn('hash', sql.raw(t.varchar(64)), (c) => c.primaryKey())
      .addColumn('text', sql.raw(t.text), (c) => c.notNull())
      .addColumn('size', sql.raw(t.integer), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createTable('workspace_file')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('path', sql.raw(t.varchar(512)), (c) => c.notNull())
      // The file's hash when the workspace opened (null: it was not there), and now (null: removed).
      .addColumn('base_hash', sql.raw(t.varchar(64)))
      .addColumn('hash', sql.raw(t.varchar(64)))
      // The class of the workspace's change to it (story 382's four), set as it is saved.
      .addColumn('class', sql.raw(t.varchar(16)))
      .addPrimaryKeyConstraint('pk_workspace_file', ['workspace_id', 'path'])
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_file_hash')
      .on('workspace_file')
      .columns(['hash'])
      .execute()

    const add = async (table: string, column: string, type: string, notNullDefault?: string) => {
      await db.q.schema
        .alterTable(table)
        .addColumn(column, sql.raw(type), (c) =>
          notNullDefault === undefined ? c : c.notNull().defaultTo(sql.raw(notNullDefault)),
        )
        .execute()
    }
    await add(
      'workspace',
      'schema_built',
      t.boolean,
      db.dialect.name === 'postgres' ? 'false' : '0',
    )
    for (const table of ['content_type', 'data_type']) {
      await add(table, 'workspace_id', t.integer)
      await add(table, 'origin_key', t.uuid)
    }
    await add('property_type', 'origin_key', t.uuid)
    await add('property_type_group', 'origin_key', t.uuid)
    await db.q.schema
      .createIndex('ix_content_type_workspace')
      .on('content_type')
      .columns(['workspace_id', 'origin_key'])
      .execute()
    await db.q.schema
      .createIndex('ix_data_type_workspace')
      .on('data_type')
      .columns(['workspace_id', 'origin_key'])
      .execute()

    // An alias is Shared's to hold once; a workspace's copy holds it again, in its own.
    await db.q.schema.dropIndex('ux_content_type_alias').execute()
    await db.q.schema
      .createIndex('ux_content_type_alias')
      .on('content_type')
      .column('alias')
      .unique()
      .where(sql.ref('workspace_id'), 'is', null)
      .execute()
    await db.q.schema
      .createIndex('ux_content_type_workspace_alias')
      .on('content_type')
      .columns(['workspace_id', 'alias'])
      .unique()
      .where(sql.ref('workspace_id'), 'is not', null)
      .execute()
  },
}
