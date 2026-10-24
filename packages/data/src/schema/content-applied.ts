/**
 * Migration 049 — what an import last applied to each node (story 163).
 *
 * `content_applied` holds, per node, the values, names, order and parent the
 * last import that wrote it left there. A later import compares three ways —
 * the bundle, the site and this — so a change made only in the bundle is
 * taken, one made only here is kept, and only a change made in both is a
 * decision for a person. The state before the run is kept beside it, so a
 * revert puts the record back as well as the content.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_DROP_ASSISTANT } from './drop-assistant.ts'

export const STATE_CONTENT_APPLIED = '{5d1f8a3c-0049-4e72-b6a9-3c8e1f4d2b49}'

export const contentAppliedMigration: Migration = {
  from: STATE_DROP_ASSISTANT,
  to: STATE_CONTENT_APPLIED,
  name: 'AddContentApplied',
  kind: 'expand',
  release: '0.28.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.exec(
      `CREATE TABLE content_applied (
         node_key ${t.uuid} PRIMARY KEY,
         run_id ${t.varchar(64)} NOT NULL,
         state ${t.text} NOT NULL,
         applied_at ${t.timestamp} NOT NULL,
         previous_run_id ${t.varchar(64)},
         previous_state ${t.text}
       )`,
    )
  },
}
