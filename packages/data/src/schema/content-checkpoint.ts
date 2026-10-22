/**
 * Migration 047 — the content checkpoint (story 174).
 *
 * One row, `content_checkpoint`, counts the committed changes to anything the
 * published cache reads. Every such change increments it inside its own
 * transaction, which holds the row until it commits, so the count's order is
 * the commit order on both dialects. Cache instructions carry the number, and
 * each node records the one it serves.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_CONTENT_EVENTS } from './content-events.ts'

export const STATE_CONTENT_CHECKPOINT = '{6b2e8f14-0047-4d93-a5c1-9e3f7b2d4c47}'

export const contentCheckpointMigration: Migration = {
  from: STATE_CONTENT_EVENTS,
  to: STATE_CONTENT_CHECKPOINT,
  name: 'AddContentCheckpoint',
  kind: 'expand',
  release: '0.25.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.exec(
      `CREATE TABLE content_checkpoint (
         id ${t.integer} PRIMARY KEY,
         n ${t.bigint} NOT NULL
       )`,
    )
    await db.exec('INSERT INTO content_checkpoint (id, n) VALUES (1, 0)')
    await db.exec(`ALTER TABLE cache_instruction ADD COLUMN checkpoint ${t.bigint}`)
    await db.exec(`ALTER TABLE server ADD COLUMN served_checkpoint ${t.bigint}`)
    await db.exec(`ALTER TABLE server ADD COLUMN served_at ${t.timestamp}`)
  },
}
