/**
 * Migration 081 — single-use tokens (story 368). 364's `remote_exchange_id`
 * becomes `single_use_token`: the ids of tokens that may be used once, kept
 * until each expires, for the remote's exchange and for preview links alike.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_EXCHANGE_ACTOR } from './exchange-actor.ts'

export const STATE_SINGLE_USE_TOKEN = '{5c9a2e71-0081-4d3b-8f6a-2e7b1c4d0081}'

export const singleUseTokenMigration: Migration = {
  from: STATE_EXCHANGE_ACTOR,
  to: STATE_SINGLE_USE_TOKEN,
  name: 'RenameSingleUseToken',
  kind: 'expand',
  release: '0.69.0',
  async up(db: Db) {
    await db.q.schema.dropIndex('ux_remote_exchange_id').execute()
    await db.q.schema.alterTable('remote_exchange_id').renameTo('single_use_token').execute()
    await db.q.schema
      .createIndex('ux_single_use_token')
      .unique()
      .on('single_use_token')
      .columns(['issuer', 'token_id'])
      .execute()
  },
}
