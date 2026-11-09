/**
 * Migration 066 — what a grant covers beyond the permissions' names (story
 * 308): the origins its `http.outbound` may reach, and whom `actAs` acts for.
 * Nullable: a grant before this one covered neither.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_TRANSFER_RUN_BUNDLE_TYPE } from './transfer-run-bundle-type.ts'

export const STATE_BUNDLE_GRANT_REACH = '{c3e7a512-0066-4f0b-9d61-a8b2c4e60066}'

export const bundleGrantReachMigration: Migration = {
  from: STATE_TRANSFER_RUN_BUNDLE_TYPE,
  to: STATE_BUNDLE_GRANT_REACH,
  name: 'AddBundleGrantReach',
  kind: 'expand',
  release: '0.57.0',
  async up(db: Db) {
    const ops = schemaOps(db)
    await ops.addColumn('bundle_grant', 'origins', db.dialect.types.text)
    await ops.addColumn('bundle_grant', 'act_as', db.dialect.types.varchar(80))
  },
}
