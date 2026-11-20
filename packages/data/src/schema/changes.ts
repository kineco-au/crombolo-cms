/**
 * Migration 086 — every change is recorded (story 381). A change is a run, as an
 * applied bundle's is: a merged workspace, a direct edit of the definitions or
 * files, or a revert, with its name, its identity, who made it and where it came
 * from. Each file it touched, a type's file included, is a `change_item` with its
 * text before and after, kept by hash in `file_blob`; its pages are the run's
 * `content_transfer_change` rows, as they are for a bundle.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_SCHEMA } from './workspace-schema.ts'

export const STATE_CHANGES = '{4c8a2e19-0086-4d7f-9b31-6e0c5a8d0086}'

/** The columns the migration adds to `content_transfer_run`, for a rewind to drop. */
export const CHANGE_RUN_COLUMNS = [
  'change_kind',
  'name',
  'change_key',
  'made_by',
  'workspace_key',
  'closed_at',
] as const

export const changesMigration: Migration = {
  from: STATE_WORKSPACE_SCHEMA,
  to: STATE_CHANGES,
  name: 'AddChanges',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    const add = async (column: string, type: string, notNullDefault?: string) => {
      await db.q.schema
        .alterTable('content_transfer_run')
        .addColumn(column, sql.raw(type), (c) =>
          notNullDefault === undefined ? c : c.notNull().defaultTo(sql.raw(notNullDefault)),
        )
        .execute()
    }
    // `bundle` for every run before this; `merge`, `edit` and `revert` from here.
    await add('change_kind', t.varchar(16), "'bundle'")
    await add('name', t.varchar(255))
    await add('change_key', t.varchar(64))
    await add('made_by', t.varchar(255))
    await add('workspace_key', t.varchar(64))
    // A direct edit is open while its author keeps editing; then it closes.
    await add('closed_at', t.timestamp)
    await db.q.schema
      .createTable('change_item')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('run_id', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('path', sql.raw(t.varchar(512)), (c) => c.notNull())
      .addColumn('kind', sql.raw(t.varchar(32)), (c) => c.notNull())
      .addColumn('class', sql.raw(t.varchar(16)), (c) => c.notNull())
      .addColumn('before_hash', sql.raw(t.varchar(64)))
      .addColumn('after_hash', sql.raw(t.varchar(64)))
      .execute()
    await db.q.schema
      .createIndex('ix_change_item_path')
      .on('change_item')
      .columns(['path', 'run_id'])
      .execute()
    await db.q.schema.createIndex('ix_change_item_run').on('change_item').column('run_id').execute()
  },
}
