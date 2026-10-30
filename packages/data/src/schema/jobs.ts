/**
 * Migration 055: background jobs for the site and its bundles (story 187). One
 * queue for every owner, claimed atomically and retried with back-off, and each
 * schedule's last occurrence, compared and set so exactly one node runs it.
 */
import { sql } from 'kysely'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_BUNDLE_GRANTS } from './bundle-grants.ts'

export const STATE_JOBS = '{4b198f00-0055-4ca8-bc39-97d92fca0055}'

export const jobsMigration: Migration = {
  from: STATE_BUNDLE_GRANTS,
  to: STATE_JOBS,
  name: 'AddJobs',
  kind: 'expand',
  release: '0.38.0',
  async up(db: Db) {
    const t = db.dialect.types
    const type = (name: string) => sql.raw(name)
    await db.q.schema
      .createTable('job')
      .addColumn('id', type(t.uuid), (c) => c.primaryKey())
      .addColumn('owner', type(t.varchar(64)), (c) => c.notNull())
      .addColumn('name', type(t.varchar(128)), (c) => c.notNull())
      .addColumn('payload', type(t.json), (c) => c.notNull())
      .addColumn('state', type(t.varchar(16)), (c) => c.notNull())
      .addColumn('attempts', type(t.integer), (c) => c.notNull())
      .addColumn('max_attempts', type(t.integer), (c) => c.notNull())
      .addColumn('next_attempt_at', type(t.timestamp), (c) => c.notNull())
      .addColumn('claimed_by', type(t.varchar(255)))
      .addColumn('claimed_at', type(t.timestamp))
      .addColumn('progress', type(t.json))
      .addColumn('last_error', type(t.text))
      .addColumn('queued_by', type(t.varchar(255)))
      .addColumn('created_at', type(t.timestamp), (c) => c.notNull())
      .addColumn('finished_at', type(t.timestamp))
      .execute()
    await db.q.schema
      .createIndex('ix_job_due')
      .on('job')
      .columns(['state', 'next_attempt_at'])
      .execute()
    await db.q.schema
      .createIndex('ix_job_owner')
      .on('job')
      .columns(['owner', 'created_at'])
      .execute()
    await db.q.schema
      .createTable('job_schedule')
      .addColumn('schedule_key', type(t.varchar(200)), (c) => c.primaryKey())
      .addColumn('last_occurrence', type(t.timestamp), (c) => c.notNull())
      .execute()
  },
}
