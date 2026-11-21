/**
 * Migration 090 — a workspace's privacy (story 384), chosen by its owner: who can see
 * it (`members`, or `editors`, everyone who may edit, its changes readable and editable
 * only by its members), and whether someone opening an item it changed is told so.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_ENVIRONMENT_VALUES } from './environment-values.ts'

export const STATE_WORKSPACE_PRIVACY = '{2b8f4c61-0090-4e7a-9d13-5c6a1e2f0090}'

export const workspacePrivacyMigration: Migration = {
  from: STATE_ENVIRONMENT_VALUES,
  to: STATE_WORKSPACE_PRIVACY,
  name: 'AddWorkspacePrivacy',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .alterTable('workspace')
      .addColumn('visibility', sql.raw(t.varchar(16)), (c) => c.notNull().defaultTo('members'))
      .execute()
    await db.q.schema
      .alterTable('workspace')
      .addColumn('tell_others', sql.raw(t.boolean), (c) =>
        c.notNull().defaultTo(sql.raw(db.dialect.name === 'postgres' ? 'true' : '1')),
      )
      .execute()
  },
}
