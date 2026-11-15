/**
 * Migration 078 — command-line tokens (story 351): each one named, its
 * person's, kept only as a hash, with when it expires, was last used and was
 * revoked. A name is used once per person among those not revoked.
 * Administrators are given `Crombolo.CliTokens.Create` as the seed gives it,
 * through `grantBuiltInPermissions`, as migration 045 gave the media verbs.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { grantBuiltInPermissions } from './seed.ts'
import { STATE_SESSION_VIEW_AS } from './session-view-as.ts'

export const STATE_CLI_TOKENS = '{3c8e1f57-0078-4d2a-b6e9-1a5f7c3d0078}'

export const cliTokensMigration: Migration = {
  from: STATE_SESSION_VIEW_AS,
  to: STATE_CLI_TOKENS,
  name: 'AddCliTokens',
  kind: 'expand',
  release: '0.66.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('cli_token')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('key', sql.raw(t.uuid), (c) => c.notNull().unique())
      .addColumn('user_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('name', sql.raw(t.varchar(100)), (c) => c.notNull())
      .addColumn('token_hash', sql.raw(t.varchar(64)), (c) => c.notNull().unique())
      .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('last_used_at', sql.raw(t.timestamp))
      .addColumn('revoked_at', sql.raw(t.timestamp))
      .addColumn('revoked_by', sql.raw(t.varchar(64)))
      .execute()
    await db.q.schema
      .createIndex('ux_cli_token_name')
      .unique()
      .on('cli_token')
      .columns(['user_id', 'name'])
      .where(sql.ref('revoked_at'), 'is', null)
      .execute()
    await grantBuiltInPermissions(db)
  },
}
