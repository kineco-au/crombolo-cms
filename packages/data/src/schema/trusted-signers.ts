/**
 * Migration 069 — the keys and CI sources a site trusts to sign the site
 * bundles it applies (story 316), and who signed each applied run's bundle, so
 * an older version from the same signer is refused.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_BUNDLE_KIND } from './bundle-kind.ts'

export const STATE_TRUSTED_SIGNERS = '{e5a9c734-0069-4d2b-9f83-cad4e6081069}'

export const trustedSignersMigration: Migration = {
  from: STATE_BUNDLE_KIND,
  to: STATE_TRUSTED_SIGNERS,
  name: 'AddTrustedSigners',
  kind: 'expand',
  release: '0.57.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('trusted_signer')
      .addColumn('id', sql.raw(t.varchar(36)), (c) => c.primaryKey())
      .addColumn('kind', sql.raw(t.varchar(16)), (c) => c.notNull())
      .addColumn('name', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('public_key', sql.raw(t.text))
      .addColumn('fingerprint', sql.raw(t.varchar(64)))
      .addColumn('source', sql.raw(t.varchar(255)))
      .addColumn('added_by', sql.raw(t.varchar(255)))
      .addColumn('added_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('last_signed_at', sql.raw(t.timestamp))
      .execute()
    await db.q.schema
      .alterTable('content_transfer_run')
      .addColumn('signed_by', sql.raw(t.varchar(255)))
      .execute()
  },
}
