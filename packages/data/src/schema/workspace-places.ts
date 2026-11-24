/**
 * Migration 098 — Content is what a workspace holds (story 419). Library and
 * Translation are places under Content, so a group holding either without Content
 * gains Content, which opens nothing by itself; and languages are Translation's, so a
 * group holding Structure without Translation gains Translation, keeping the
 * languages it could change. Nobody loses anything they could open.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_WORKSPACE_SCHEDULES } from './workspace-schedules.ts'

export const STATE_WORKSPACE_PLACES = '{4e7a1c93-0098-4b6d-a2f5-7c1e9d3b0098}'

/** Each grant a group gains (`alias`) from one it holds (`from`). */
const GAINS: ReadonlyArray<{ alias: string; from: readonly string[] }> = [
  { alias: 'content', from: ['library', 'translation'] },
  { alias: 'translation', from: ['structure'] },
]

export const workspacePlacesMigration: Migration = {
  from: STATE_WORKSPACE_SCHEDULES,
  to: STATE_WORKSPACE_PLACES,
  name: 'AddWorkspacePlaces',
  kind: 'expand',
  release: '0.79.0',
  async up(db: Db) {
    for (const { alias, from } of GAINS)
      await db.q
        .insertInto('user_group_section')
        .columns(['user_group_id', 'app_alias'])
        .expression((eb) =>
          eb
            .selectFrom('user_group_section as held')
            .select(['held.user_group_id', eb.val(alias).as('app_alias')])
            .where('held.app_alias', 'in', [...from])
            .where((w) =>
              w.not(
                w.exists(
                  w
                    .selectFrom('user_group_section as has')
                    .select('has.app_alias')
                    .whereRef('has.user_group_id', '=', 'held.user_group_id')
                    .where('has.app_alias', '=', alias),
                ),
              ),
            )
            .distinct(),
        )
        .execute()
  },
}
