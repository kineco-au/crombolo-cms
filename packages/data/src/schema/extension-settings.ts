/**
 * Migration 067 — an extension's settings as an administrator set them in the
 * back office (story 310). The config's values are not kept here: they lock the
 * setting instead. A secret is kept sealed with the site's key.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_BUNDLE_GRANT_REACH } from './bundle-grant-reach.ts'

export const STATE_EXTENSION_SETTINGS = '{c3e7a512-0067-4f0b-9d61-a8b2c4e60067}'

export const extensionSettingsMigration: Migration = {
  from: STATE_BUNDLE_GRANT_REACH,
  to: STATE_EXTENSION_SETTINGS,
  name: 'AddExtensionSettings',
  kind: 'expand',
  release: '0.57.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('extension_setting')
      .addColumn('bundle_id', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('setting_key', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('value', sql.raw(t.text), (c) => c.notNull())
      .addColumn('updated_by', sql.raw(t.varchar(255)))
      .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addPrimaryKeyConstraint('pk_extension_setting', ['bundle_id', 'setting_key'])
      .execute()
  },
}
