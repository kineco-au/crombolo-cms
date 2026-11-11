/**
 * Migration 072 — what each extension did (story 327): one row per write,
 * request out, rows written, refusal, call and screen, and one per minute for
 * the reads of one kind it made for one person. No statement text, body or
 * value is kept: the kind, the area, the verb, the key, a count, the outcome
 * and the time taken.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_BUNDLE_GRANT_DELEGATE } from './bundle-grant-delegate.ts'

export const STATE_EXTENSION_ACTIVITY = '{a8e3c51d-0072-4b9e-9c04-6d2f7b1e8072}'

export const extensionActivityMigration: Migration = {
  from: STATE_BUNDLE_GRANT_DELEGATE,
  to: STATE_EXTENSION_ACTIVITY,
  name: 'AddExtensionActivity',
  kind: 'expand',
  release: '0.61.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('extension_activity')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('extension_id', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('person_key', sql.raw(t.varchar(64)))
      .addColumn('person_name', sql.raw(t.varchar(255)))
      .addColumn('kind', sql.raw(t.varchar(16)), (c) => c.notNull())
      .addColumn('area', sql.raw(t.varchar(255)))
      .addColumn('verb', sql.raw(t.varchar(64)))
      .addColumn('entity_key', sql.raw(t.varchar(255)))
      .addColumn('count', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('outcome', sql.raw(t.varchar(16)), (c) => c.notNull())
      .addColumn('ms', sql.raw(t.integer))
      .addColumn('occurred_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('extension_activity_by_extension')
      .on('extension_activity')
      .columns(['extension_id', 'occurred_at'])
      .execute()
  },
}
