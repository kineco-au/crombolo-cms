/**
 * Migration 057: a content type can be a site's settings (story 058). Its page,
 * a direct child of a root, holds that site's settings and has no address.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_BUNDLES_DISABLED } from './bundles-disabled.ts'

export const STATE_SITE_SETTINGS_TYPES = '{4b198f00-0057-4ca8-bc39-97d92fca0057}'

export const siteSettingsTypesMigration: Migration = {
  from: STATE_BUNDLES_DISABLED,
  to: STATE_SITE_SETTINGS_TYPES,
  name: 'AddSiteSettingsTypes',
  kind: 'expand',
  release: '0.40.0',
  async up(db: Db) {
    const t = db.dialect.types
    const postgres = db.dialect.name === 'postgres'
    await schemaOps(db).addColumn(
      'content_type',
      'site_settings',
      `${t.boolean} NOT NULL DEFAULT ${postgres ? 'FALSE' : '0'}`,
    )
  },
}
