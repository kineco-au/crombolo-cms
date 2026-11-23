/**
 * Migration 096 — what went wrong rendering a workspace's pages, as each node notes it
 * (story 408), so any node answers a workspace's errors for the whole site.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_GROUP_START_KEYS } from './group-start-keys.ts'

export const STATE_WORKSPACE_ERRORS = '{3b9f6d52-0096-4e1a-b7c4-2a8d5f1e0096}'

export const workspaceErrorsMigration: Migration = {
  from: STATE_GROUP_START_KEYS,
  to: STATE_WORKSPACE_ERRORS,
  name: 'AddWorkspaceErrors',
  kind: 'expand',
  release: '0.76.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('workspace_error')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('workspace_key', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('node_id', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('page', sql.raw(t.varchar(1000)), (c) => c.notNull())
      .addColumn('says', sql.raw(t.varchar(4000)), (c) => c.notNull())
      .addColumn('noted_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_error_workspace')
      .on('workspace_error')
      .columns(['workspace_key', 'id'])
      .execute()
  },
}
