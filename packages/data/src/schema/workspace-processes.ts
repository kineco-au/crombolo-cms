/**
 * Migration 092 — the processes workspaces render in, as each node reports them
 * (story 396): which run where, and each that failed, so any node can say which
 * workspace keeps failing, whichever node it fails on.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_SERVED_CHANGES } from './served-changes.ts'

export const STATE_WORKSPACE_PROCESSES = '{8d1e4b27-0092-4c6a-a3f8-7b2c9e5d0092}'

export const workspaceProcessesMigration: Migration = {
  from: STATE_SERVED_CHANGES,
  to: STATE_WORKSPACE_PROCESSES,
  name: 'AddWorkspaceProcesses',
  kind: 'expand',
  release: '0.73.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('workspace_process')
      .addColumn('node_id', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('workspace_key', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('started_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addPrimaryKeyConstraint('pk_workspace_process', ['node_id', 'workspace_key'])
      .execute()
    await db.q.schema
      .createTable('workspace_process_failure')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('node_id', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('workspace_key', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('reason', sql.raw(t.varchar(1000)), (c) => c.notNull())
      .addColumn('failed_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_process_failure_at')
      .on('workspace_process_failure')
      .column('failed_at')
      .execute()
  },
}
