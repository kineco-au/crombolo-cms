/**
 * Migration 097 — a schedule set in a workspace goes with its change (story 414): which
 * pages a workspace set a schedule for, with Shared's as it was then, so its merge knows
 * a clear from no change and a schedule changed in Shared since; and which change set
 * each schedule Shared holds, named when it fires.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_ERRORS } from './workspace-errors.ts'

export const STATE_WORKSPACE_SCHEDULES = '{3b9f6d52-0097-4e1a-b7c4-2a8d5f1e0097}'

export const workspaceSchedulesMigration: Migration = {
  from: STATE_WORKSPACE_ERRORS,
  to: STATE_WORKSPACE_SCHEDULES,
  name: 'AddWorkspaceSchedules',
  kind: 'expand',
  release: '0.77.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('workspace_schedule')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('node_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('base', sql.raw(t.text), (c) => c.notNull())
      .addPrimaryKeyConstraint('pk_workspace_schedule', ['workspace_id', 'node_id'])
      .execute()
    await db.q.schema
      .alterTable('content_schedule')
      .addColumn('change_key', sql.raw(t.varchar(64)))
      .execute()
  },
}
