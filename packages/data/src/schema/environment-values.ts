/**
 * Migration 089 — a value per environment (story 387): `property_value.environment`,
 * beside language and segment, null for the shared value. A property that varies by
 * environment serves the current environment's value where there is one, and the
 * shared value otherwise.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_CHANGE_TRANSFER } from './change-transfer.ts'

export const STATE_ENVIRONMENT_VALUES = '{7a3d5e10-0089-4b6c-8e21-3f9c0d4a0089}'

export const environmentValuesMigration: Migration = {
  from: STATE_CHANGE_TRANSFER,
  to: STATE_ENVIRONMENT_VALUES,
  name: 'AddEnvironmentValues',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .alterTable('property_value')
      .addColumn('environment', sql.raw(t.varchar(64)))
      .execute()
  },
}
