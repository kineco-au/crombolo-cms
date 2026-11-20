/**
 * Migration 088 — changes moved between sites (story 383): each change applied
 * here, by the identity it carried, so one that comes back by another route is
 * known; and the changes a staged workspace holds, which nobody edits.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_LINKS } from './workspace-links.ts'

export const STATE_CHANGE_TRANSFER = '{4c7e1b92-0088-4d3a-9f25-7b1e6a3c0088}'

export const changeTransferMigration: Migration = {
  from: STATE_WORKSPACE_LINKS,
  to: STATE_CHANGE_TRANSFER,
  name: 'AddChangeTransfer',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('applied_change')
      .addColumn('change_key', sql.raw(t.varchar(36)), (c) => c.primaryKey())
      .addColumn('run_id', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('name', sql.raw(t.varchar(255)))
      .addColumn('applied_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema.alterTable('workspace').addColumn('staged_changes', sql.raw(t.text)).execute()
  },
}
