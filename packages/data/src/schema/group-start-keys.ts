/**
 * Migration 095 — a group's start node kept by key while its item is not on this site
 * (story 405): a group defined outside the site names its start nodes by key, and one
 * whose item has not arrived yet waits here, giving no start in that tree until it does.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_CHANGE_SOURCES } from './change-sources.ts'

export const STATE_GROUP_START_KEYS = '{7e4c1a83-0095-4d9f-a031-5c8f1e6d0095}'

export const groupStartKeysMigration: Migration = {
  from: STATE_CHANGE_SOURCES,
  to: STATE_GROUP_START_KEYS,
  name: 'AddGroupStartKeys',
  kind: 'expand',
  release: '0.75.0',
  async up(db: Db) {
    const ops = schemaOps(db)
    const text = db.dialect.types.varchar(36)
    for (const column of ['start_content_key', 'start_media_key', 'start_element_key'])
      await ops.addColumn('user_group', column, text)
  },
}
