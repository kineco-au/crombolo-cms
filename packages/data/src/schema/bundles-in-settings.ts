/**
 * Migration 060: Bundles is a Settings tool (story 238), so no group keeps the
 * Packages section that held it. Whoever has Settings has Bundles.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_FORM_LIBRARY } from './form-library.ts'

export const STATE_BUNDLES_IN_SETTINGS = '{4b198f00-0060-4ca8-bc39-97d92fca0060}'

export const bundlesInSettingsMigration: Migration = {
  from: STATE_FORM_LIBRARY,
  to: STATE_BUNDLES_IN_SETTINGS,
  name: 'MoveBundlesIntoSettings',
  kind: 'expand',
  release: '0.44.0',
  async up(db: Db) {
    await db.q.deleteFrom('user_group_section').where('app_alias', '=', 'packages').execute()
  },
}
