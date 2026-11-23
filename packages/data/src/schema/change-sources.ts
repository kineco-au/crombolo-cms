/**
 * Migration 094 — where a site bundle staged as a change came from (story 399): each
 * source's base, the items as it last merged them, and what each workspace staged from
 * one holds until it merges.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_CONFLICTS } from './workspace-conflicts.ts'

export const STATE_CHANGE_SOURCES = '{6d3b0f72-0094-4c8e-9f20-4b7e0d5c0094}'

export const changeSourcesMigration: Migration = {
  from: STATE_WORKSPACE_CONFLICTS,
  to: STATE_CHANGE_SOURCES,
  name: 'AddChangeSources',
  kind: 'expand',
  release: '0.74.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('change_source')
      .addColumn('name', sql.raw(t.varchar(255)), (c) => c.primaryKey())
      .addColumn('snapshot', sql.raw(t.text), (c) => c.notNull())
      .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createTable('change_source_staged')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.primaryKey())
      .addColumn('source', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('snapshot', sql.raw(t.text), (c) => c.notNull())
      .execute()
  },
}
