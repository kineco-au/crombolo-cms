/**
 * Migration 091 — what the served copy holds, and notices for a person (story 395):
 * each change a host reports applying to the served copy, and the notices a host
 * leaves for someone, kept until they see them.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_PRIVACY } from './workspace-privacy.ts'

export const STATE_SERVED_CHANGES = '{6c3a9e14-0091-4b2d-8f57-1e9d4a7c0091}'

export const servedChangesMigration: Migration = {
  from: STATE_WORKSPACE_PRIVACY,
  to: STATE_SERVED_CHANGES,
  name: 'AddServedChanges',
  kind: 'expand',
  release: '0.73.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('served_change')
      .addColumn('change_key', sql.raw(t.varchar(64)), (c) => c.primaryKey())
      .addColumn('reported_by', sql.raw(t.varchar(255)))
      .addColumn('reported_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createTable('backoffice_notice')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('user_key', sql.raw(t.uuid), (c) => c.notNull())
      .addColumn('kind', sql.raw(t.varchar(16)), (c) => c.notNull())
      .addColumn('message', sql.raw(t.varchar(1000)), (c) => c.notNull())
      .addColumn('link', sql.raw(t.varchar(1000)))
      .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('seen_at', sql.raw(t.timestamp))
      .execute()
    await db.q.schema
      .createIndex('ix_backoffice_notice_user')
      .on('backoffice_notice')
      .column('user_key')
      .execute()
  },
}
