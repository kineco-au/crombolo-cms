/**
 * Migration 107 — a workspace shared with user groups (story 451): each group it is shared
 * with, by key, so access follows the group's membership rather than a list of its people.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_SHARED_LINKS } from './shared-links.ts'

export const STATE_WORKSPACE_GROUPS = '{3b8e5c27-0107-4f1d-a6c2-7e9d0b4a0107}'

export const workspaceGroupsMigration: Migration = {
  from: STATE_SHARED_LINKS,
  to: STATE_WORKSPACE_GROUPS,
  name: 'AddWorkspaceGroups',
  kind: 'expand',
  release: '0.85.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('workspace_group')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull().references('workspace.id'))
      .addColumn('group_key', sql.raw(t.uuid), (c) => c.notNull())
      .addColumn('added_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addPrimaryKeyConstraint('pk_workspace_group', ['workspace_id', 'group_key'])
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_group_group')
      .on('workspace_group')
      .column('group_key')
      .execute()
  },
}
