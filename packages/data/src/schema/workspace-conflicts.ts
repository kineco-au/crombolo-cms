/**
 * Migration 093 — the conflicts with Shared each workspace has been told of (story
 * 400), so `Crombolo.WorkspaceConflicted` names an item once until it is settled.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_PROCESSES } from './workspace-processes.ts'

export const STATE_WORKSPACE_CONFLICTS = '{5c2a9e61-0093-4b7d-8e1f-3a6d9c4b0093}'

export const workspaceConflictsMigration: Migration = {
  from: STATE_WORKSPACE_PROCESSES,
  to: STATE_WORKSPACE_CONFLICTS,
  name: 'AddWorkspaceConflictsRaised',
  kind: 'expand',
  release: '0.74.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('workspace_conflict_raised')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('item', sql.raw(t.varchar(512)), (c) => c.notNull())
      .addColumn('raised_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addPrimaryKeyConstraint('pk_workspace_conflict_raised', ['workspace_id', 'item'])
      .execute()
  },
}
