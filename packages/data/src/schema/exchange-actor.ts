/**
 * Migration 080 — the actor an exchanged token names is in the history (story
 * 366). A device signed in by exchange keeps the actor its token named, the
 * host's tool acting for the person, and every audit entry can carry the actor
 * it was written for.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_REMOTE_EXCHANGE } from './remote-exchange.ts'

export const STATE_EXCHANGE_ACTOR = '{3b8e1f60-0080-4c2d-9a7e-1d4f6b2c0080}'

export const exchangeActorMigration: Migration = {
  from: STATE_REMOTE_EXCHANGE,
  to: STATE_EXCHANGE_ACTOR,
  name: 'AddExchangeActor',
  kind: 'expand',
  release: '0.68.0',
  async up(db: Db) {
    const t = db.dialect.types
    for (const table of ['device_authorization', 'audit_entry'] as const) {
      await db.q.schema
        .alterTable(table)
        .addColumn('actor_id', sql.raw(t.varchar(255)))
        .execute()
      await db.q.schema
        .alterTable(table)
        .addColumn('actor_name', sql.raw(t.varchar(255)))
        .execute()
    }
  },
}
