/**
 * Migration 074 — the groups that own a group (story 302): their members may
 * choose who is in it, while what it grants stays an administrator's.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_FORM_WORKFLOW_SECRETS } from './form-workflow-secrets.ts'

export const STATE_USER_GROUP_OWNERS = '{5e2a9c41-0074-4b7d-9f30-6c1d8e4a0074}'

export const userGroupOwnersMigration: Migration = {
  from: STATE_FORM_WORKFLOW_SECRETS,
  to: STATE_USER_GROUP_OWNERS,
  name: 'AddUserGroupOwners',
  kind: 'expand',
  release: '0.63.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('user_group_owner')
      .addColumn('user_group_key', sql.raw(t.uuid), (c) => c.notNull().references('user_group.key'))
      .addColumn('owner_group_key', sql.raw(t.uuid), (c) =>
        c.notNull().references('user_group.key'),
      )
      .addPrimaryKeyConstraint('user_group_owner_pk', ['user_group_key', 'owner_group_key'])
      .execute()
  },
}
