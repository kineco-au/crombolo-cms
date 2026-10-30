/**
 * Migration 054: what an administrator granted each bundle (story 222). One row
 * per bundle, replaced on each grant: the package and version it was granted
 * for, the permissions, who granted them and when. A bundle with no row, or
 * declaring more than its row holds, is off.
 */
import { sql } from 'kysely'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_MEDIA_MEMBER_GRANTS } from './media-member-grants.ts'

export const STATE_BUNDLE_GRANTS = '{4b198f00-0054-4ca8-bc39-97d92fca0054}'

export const bundleGrantsMigration: Migration = {
  from: STATE_MEDIA_MEMBER_GRANTS,
  to: STATE_BUNDLE_GRANTS,
  name: 'AddBundleGrants',
  kind: 'expand',
  release: '0.38.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('bundle_grant')
      .addColumn('bundle_id', sql.raw(t.varchar(64)), (c) => c.primaryKey())
      .addColumn('package_name', sql.raw(t.varchar(214)), (c) => c.notNull())
      .addColumn('version', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('permissions', sql.raw(t.json), (c) => c.notNull())
      .addColumn('granted_by', sql.raw(t.varchar(255)))
      .addColumn('granted_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
  },
}
