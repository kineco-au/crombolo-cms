/**
 * Migration 083 — the places under Content are grants of their own (story 385).
 * Every group keeps what it could open: one holding Content gains Pages, one
 * holding Settings gains Structure and Code (`components`), and one holding a
 * place under Content without Content gains Content, with Pages left off. A group
 * kept in a site's `schema/user-groups/*.toml` is written from its file at the
 * next sync instead, which the release notes say.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_WORKSPACES } from './workspaces.ts'

export const STATE_CONTENT_PLACES = '{4e7a1c93-0083-4b6d-a2f5-7c1e9d3b0083}'

/** Each grant a group gains (`alias`) from one it holds (`from`). */
const GAINS: ReadonlyArray<{ alias: string; from: readonly string[] }> = [
  { alias: 'pages', from: ['content'] },
  { alias: 'structure', from: ['settings'] },
  { alias: 'components', from: ['settings'] },
  { alias: 'content', from: ['media', 'workflow', 'forms'] },
]

export const contentPlacesMigration: Migration = {
  from: STATE_WORKSPACES,
  to: STATE_CONTENT_PLACES,
  name: 'AddContentPlaces',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    // One statement per grant, each adding it to every group that holds what it
    // comes from and does not hold it already.
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
