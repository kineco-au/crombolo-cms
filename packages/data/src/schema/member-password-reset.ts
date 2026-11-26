/**
 * Migration 103 — a member resets their password (story 282): the links sent to members,
 * kept by their hash until used or out of date (`member_reset_token`), and the requests
 * counted against a limit, shared by every node (`rate_limit_hit`).
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_SERVICE_ACCOUNT_SECRETS } from './service-account-secrets.ts'

export const STATE_MEMBER_PASSWORD_RESET = '{5e2b8d41-0103-4c7a-9f16-3d0b6a2e0103}'

/** The tables the migration adds, for a rewind to drop. */
export const MEMBER_PASSWORD_RESET_TABLES = ['member_reset_token', 'rate_limit_hit'] as const

export const memberPasswordResetMigration: Migration = {
  from: STATE_SERVICE_ACCOUNT_SECRETS,
  to: STATE_MEMBER_PASSWORD_RESET,
  name: 'AddMemberPasswordReset',
  kind: 'expand',
  release: '0.82.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('member_reset_token')
      .addColumn('token_hash', sql.raw(t.varchar(64)), (c) => c.primaryKey())
      .addColumn('member_key', sql.raw(t.varchar(36)), (c) => c.notNull())
      .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('create_date', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('ix_member_reset_token_member')
      .on('member_reset_token')
      .column('member_key')
      .execute()
    await db.q.schema
      .createTable('rate_limit_hit')
      .addColumn('id', sql.raw(t.varchar(36)), (c) => c.primaryKey())
      .addColumn('bucket', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('hit_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('ix_rate_limit_hit_bucket')
      .on('rate_limit_hit')
      .columns(['bucket', 'hit_at'])
      .execute()
  },
}
