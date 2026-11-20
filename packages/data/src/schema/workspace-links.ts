/**
 * Migration 087 — links to a workspace's site (story 379): made by a member,
 * each kept by the SHA-256 of its secret, reusable until it expires or is
 * withdrawn, and no use once its maker leaves the workspace.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_CHANGES } from './changes.ts'

export const STATE_WORKSPACE_LINKS = '{9e2b7d40-0087-4a1c-b6f3-2d8e5c1a0087}'

export const workspaceLinksMigration: Migration = {
  from: STATE_CHANGES,
  to: STATE_WORKSPACE_LINKS,
  name: 'AddWorkspaceLinks',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('workspace_link')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('secret_hash', sql.raw(t.varchar(64)), (c) => c.notNull().unique())
      .addColumn('made_by', sql.raw(t.uuid), (c) => c.notNull())
      .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('withdrawn_at', sql.raw(t.timestamp))
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_link_workspace')
      .on('workspace_link')
      .column('workspace_id')
      .execute()
  },
}
