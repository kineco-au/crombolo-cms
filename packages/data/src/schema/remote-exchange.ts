/**
 * Migration 079 — a person signed in through a provider reaches the remote
 * (story 364). `external_login` gains the value of the claim that names the
 * person across the provider's apps (`oid` for Entra) and the issuer it came
 * from, which the exchange finds them by; `remote_exchange_id` keeps each
 * exchanged token's one-time id until the token expires, so none is used twice.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_CLI_TOKENS } from './cli-tokens.ts'

export const STATE_REMOTE_EXCHANGE = '{7d2a9c4e-0079-4b1f-a3e8-5c6d0f2b0079}'

export const remoteExchangeMigration: Migration = {
  from: STATE_CLI_TOKENS,
  to: STATE_REMOTE_EXCHANGE,
  name: 'AddRemoteExchange',
  kind: 'expand',
  release: '0.67.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .alterTable('external_login')
      .addColumn('identity_value', sql.raw(t.varchar(255)))
      .execute()
    await db.q.schema
      .alterTable('external_login')
      .addColumn('identity_issuer', sql.raw(t.varchar(255)))
      .execute()
    await db.q.schema
      .createIndex('ix_external_login_identity')
      .on('external_login')
      .columns(['login_provider', 'identity_value'])
      .execute()
    await db.q.schema
      .createTable('remote_exchange_id')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('issuer', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('token_id', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('ux_remote_exchange_id')
      .unique()
      .on('remote_exchange_id')
      .columns(['issuer', 'token_id'])
      .execute()
  },
}
