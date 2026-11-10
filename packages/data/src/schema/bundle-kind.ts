/**
 * Migration 068 — what a Bundle Editor definition builds (story 312): an
 * extension for other sites, or a site bundle to move this site. Every
 * definition before it built an extension (story 306).
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_EXTENSION_SETTINGS } from './extension-settings.ts'

export const STATE_BUNDLE_KIND = '{d4f8b623-0068-4c1a-8e72-b9c3d5f70068}'

export const bundleKindMigration: Migration = {
  from: STATE_EXTENSION_SETTINGS,
  to: STATE_BUNDLE_KIND,
  name: 'AddBundleKind',
  kind: 'expand',
  release: '0.57.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .alterTable('bundle')
      .addColumn('kind', sql.raw(t.varchar(16)), (c) => c.notNull().defaultTo('extension'))
      .execute()
  },
}
