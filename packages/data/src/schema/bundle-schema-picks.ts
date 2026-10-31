/**
 * Migration 058: what a created bundle picks beyond Umbraco's definition (story
 * 226): its forms, approval workflows and user groups, and what its author
 * unticked of what they bring. JSON text, as the definition's other lists are.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_SITE_SETTINGS_TYPES } from './site-settings-types.ts'

export const STATE_BUNDLE_SCHEMA_PICKS = '{4b198f00-0058-4ca8-bc39-97d92fca0058}'

export const bundleSchemaPicksMigration: Migration = {
  from: STATE_SITE_SETTINGS_TYPES,
  to: STATE_BUNDLE_SCHEMA_PICKS,
  name: 'AddBundleSchemaPicks',
  kind: 'expand',
  release: '0.41.1',
  async up(db: Db) {
    await schemaOps(db).addColumn('bundle', 'schema_picks', db.dialect.types.text)
  },
}
