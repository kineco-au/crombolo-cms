/**
 * Migration 075 — the verbs story 338 takes out of the catalogue are rewritten
 * to what replaces them, or removed, in every group's defaults and in every
 * per-page, per-item and per-field row.
 *
 * A per-page or per-field set that held only dropped verbs becomes an explicit
 * "nothing here" row, Umbraco's empty verb, rather than no row: no row would
 * fall back to the group's defaults, and widen what the set allowed.
 *
 * Statements only, never a read, so an upgrade can be planned before it runs.
 */
import { PRUNED_PERMISSIONS } from '@crombolo/core'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_USER_GROUP_OWNERS } from './user-group-owners.ts'

export const STATE_PRUNED_PERMISSIONS = '{8b3d1f62-0075-4c1e-9a47-2e6f0d5c0075}'

const RENAMED = Object.entries(PRUNED_PERMISSIONS).filter(
  (entry): entry is [string, string] => entry[1] !== null,
)
const DROPPED = Object.keys(PRUNED_PERMISSIONS).filter((verb) => PRUNED_PERMISSIONS[verb] === null)

export const prunedPermissionsMigration: Migration = {
  from: STATE_USER_GROUP_OWNERS,
  to: STATE_PRUNED_PERMISSIONS,
  name: 'PruneGroupPermissions',
  kind: 'expand',
  release: '0.63.0',
  async up(db: Db) {
    for (const [before, after] of RENAMED) {
      // Defaults: a group already holding the replacement loses the old row, the rest rename it.
      await db.q
        .deleteFrom('user_group_permission')
        .where('permission', '=', before)
        .where('user_group_key', 'in', (eb) =>
          eb
            .selectFrom('user_group_permission')
            .select('user_group_key')
            .where('permission', '=', after),
        )
        .execute()
      await db.q
        .updateTable('user_group_permission')
        .set({ permission: after })
        .where('permission', '=', before)
        .execute()
      // Per place: the same, within each group's set for that place.
      await db.q
        .deleteFrom('user_group_granular_permission as g')
        .where('g.permission', '=', before)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('user_group_granular_permission as h')
              .select('h.id')
              .whereRef('h.user_group_key', '=', 'g.user_group_key')
              .whereRef('h.unique_id', '=', 'g.unique_id')
              .whereRef('h.context', '=', 'g.context')
              .where('h.permission', '=', after),
          ),
        )
        .execute()
      await db.q
        .updateTable('user_group_granular_permission')
        .set({ permission: after })
        .where('permission', '=', before)
        .execute()
    }

    // A place whose set held only dropped verbs keeps an explicit "nothing here".
    await db.q
      .insertInto('user_group_granular_permission')
      .columns(['user_group_key', 'unique_id', 'permission', 'context'])
      .expression((eb) =>
        eb
          .selectFrom('user_group_granular_permission as g')
          .select(['g.user_group_key', 'g.unique_id', eb.val('').as('permission'), 'g.context'])
          .distinct()
          .where('g.permission', 'in', DROPPED)
          .where((inner) =>
            inner.not(
              inner.exists(
                inner
                  .selectFrom('user_group_granular_permission as h')
                  .select('h.id')
                  .whereRef('h.user_group_key', '=', 'g.user_group_key')
                  .whereRef('h.unique_id', '=', 'g.unique_id')
                  .whereRef('h.context', '=', 'g.context')
                  .where('h.permission', 'not in', DROPPED),
              ),
            ),
          ),
      )
      .execute()
    await db.q
      .deleteFrom('user_group_granular_permission')
      .where('permission', 'in', DROPPED)
      .execute()
    await db.q.deleteFrom('user_group_permission').where('permission', 'in', DROPPED).execute()
  },
}
