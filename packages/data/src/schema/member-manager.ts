/**
 * Migration 105 — a member's manager (story 445): `member.managed_by`, the API client a
 * listed directory created the member as, or null for the site's own. No member from
 * before is given one.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WEBHOOK_EVENT_NAMES } from './webhook-event-names.ts'

export const STATE_MEMBER_MANAGER = '{8c3f1a62-0105-4e9d-b2a7-5d4e0c6f0105}'

export const memberManagerMigration: Migration = {
  from: STATE_WEBHOOK_EVENT_NAMES,
  to: STATE_MEMBER_MANAGER,
  name: 'AddMemberManager',
  kind: 'expand',
  release: '0.83.0',
  async up(db: Db) {
    await db.q.schema
      .alterTable('member')
      .addColumn('managed_by', sql.raw(db.dialect.types.varchar(255)))
      .execute()
  },
}
