/**
 * Migration 106 — links to Shared (story 447): made by anyone who may use workspaces,
 * each kept by the SHA-256 of its secret, reusable until it lapses or is withdrawn, and
 * no use once its maker loses the Content section. `writes`, which only an
 * administrator's link has, lets its holder do more than look.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_MEMBER_MANAGER } from './member-manager.ts'

export const STATE_SHARED_LINKS = '{5d7e2b91-0106-4c3a-9f8e-1b6a4d2c0106}'

export const sharedLinksMigration: Migration = {
  from: STATE_MEMBER_MANAGER,
  to: STATE_SHARED_LINKS,
  name: 'AddSharedLinks',
  kind: 'expand',
  release: '0.83.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('shared_link')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('secret_hash', sql.raw(t.varchar(64)), (c) => c.notNull().unique())
      .addColumn('made_by', sql.raw(t.uuid), (c) => c.notNull())
      .addColumn('writes', sql.raw(t.boolean), (c) => c.notNull())
      .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('withdrawn_at', sql.raw(t.timestamp))
      .execute()
  },
}
