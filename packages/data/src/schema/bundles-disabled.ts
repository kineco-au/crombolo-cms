/**
 * Migration 056: an administrator can disable a bundle (story 225). Its row in
 * `bundle_grant` says who disabled it and when; a bundle with neither runs.
 */
import { sql } from 'kysely'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_JOBS } from './jobs.ts'

export const STATE_BUNDLES_DISABLED = '{4b198f00-0056-4ca8-bc39-97d92fca0056}'

export const bundlesDisabledMigration: Migration = {
  from: STATE_JOBS,
  to: STATE_BUNDLES_DISABLED,
  name: 'DisableBundles',
  kind: 'expand',
  release: '0.39.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .alterTable('bundle_grant')
      .addColumn('disabled_by', sql.raw(t.varchar(255)))
      .execute()
    await db.q.schema
      .alterTable('bundle_grant')
      .addColumn('disabled_at', sql.raw(t.timestamp))
      .execute()
  },
}
