/**
 * Migration 100 — Users are in Settings (story 429), and need it: each group holding Users
 * without Settings gains Settings, so nobody loses the users they could open.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_WORKSPACE_DESCRIPTION } from './workspace-description.ts'

export const STATE_USERS_IN_SETTINGS = '{2f6b9d40-0100-4c8e-b173-5e0d8a6c0100}'

export const usersInSettingsMigration: Migration = {
  from: STATE_WORKSPACE_DESCRIPTION,
  to: STATE_USERS_IN_SETTINGS,
  name: 'PutUsersInSettings',
  kind: 'expand',
  release: '0.80.0',
  async up(db: Db) {
    await db.q
      .insertInto('user_group_section')
      .columns(['user_group_id', 'app_alias'])
      .expression((eb) =>
        eb
          .selectFrom('user_group_section as held')
          .select(['held.user_group_id', eb.val('settings').as('app_alias')])
          .where('held.app_alias', '=', 'users')
          .where((w) =>
            w.not(
              w.exists(
                w
                  .selectFrom('user_group_section as has')
                  .select('has.app_alias')
                  .whereRef('has.user_group_id', '=', 'held.user_group_id')
                  .where('has.app_alias', '=', 'settings'),
              ),
            ),
          )
          .distinct(),
      )
      .execute()
  },
}
