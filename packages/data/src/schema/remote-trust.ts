/**
 * Migration 061: signing in to a remote from CI (story 160). A trust rule says
 * which CI identity, by its provider's signed token, may act on this site and
 * with which remote permissions; a CI token is what an accepted identity token
 * is exchanged for, stored by its hash, its identity token's `jti` once only.
 */
import { sql } from 'kysely'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_BUNDLES_IN_SETTINGS } from './bundles-in-settings.ts'

export const STATE_REMOTE_TRUST = '{4b198f00-0061-4ca8-bc39-97d92fca0061}'

export const remoteTrustMigration: Migration = {
  from: STATE_BUNDLES_IN_SETTINGS,
  to: STATE_REMOTE_TRUST,
  name: 'AddRemoteTrust',
  kind: 'expand',
  release: '0.44.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('remote_trust_rule')
      .addColumn('key', sql.raw(t.varchar(36)), (c) => c.primaryKey())
      .addColumn('name', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('issuer', sql.raw(t.varchar(512)), (c) => c.notNull())
      .addColumn('repository', sql.raw(t.varchar(512)), (c) => c.notNull())
      .addColumn('ref_kind', sql.raw(t.varchar(16)), (c) => c.notNull())
      .addColumn('ref_value', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('permissions', sql.raw(t.json), (c) => c.notNull())
      .addColumn('disabled_at', sql.raw(t.timestamp))
      .addColumn('created_by', sql.raw(t.varchar(255)))
      .addColumn('create_date', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('update_date', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('last_used_date', sql.raw(t.timestamp))
      .execute()
    await db.q.schema
      .createTable('remote_ci_token')
      .addColumn('token_hash', sql.raw(t.varchar(64)), (c) => c.primaryKey())
      .addColumn('rule_key', sql.raw(t.varchar(36)), (c) => c.notNull())
      .addColumn('issuer', sql.raw(t.varchar(512)), (c) => c.notNull())
      .addColumn('jti', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('claims', sql.raw(t.json), (c) => c.notNull())
      .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('create_date', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await schemaOps(db).addIndex(
      'ux_remote_ci_token_jti',
      'remote_ci_token',
      ['issuer', 'jti'],
      true,
    )
  },
}
