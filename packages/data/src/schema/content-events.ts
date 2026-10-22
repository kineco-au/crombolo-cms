/**
 * Migration 046 — the content event outbox (story 171).
 *
 * `content_event` holds what a change announces, written in the change's own
 * transaction: the facts as they were when it committed, and who made it. A
 * dispatcher turns each into webhook deliveries and content notifications. The
 * unique keys on those let it repeat a step after a crash without queueing
 * anything twice.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_MEDIA_PERMISSIONS } from './media-permissions.ts'

export const STATE_CONTENT_EVENTS = '{3e9b7d25-0046-4a1c-8f63-2d5c9e1b7a46}'

export const contentEventsMigration: Migration = {
  from: STATE_MEDIA_PERMISSIONS,
  to: STATE_CONTENT_EVENTS,
  name: 'AddContentEvents',
  kind: 'expand',
  release: '0.24.1',
  async up(db: Db) {
    const t = db.dialect.types
    await db.exec(
      `CREATE TABLE content_event (
         id ${t.varchar(64)} PRIMARY KEY,
         kind ${t.varchar(32)} NOT NULL,
         entity_type ${t.varchar(32)} NOT NULL,
         entity_key ${t.uuid},
         facts ${t.text} NOT NULL,
         actor ${t.text} NOT NULL,
         occurred_at ${t.timestamp} NOT NULL,
         state ${t.varchar(16)} NOT NULL,
         attempts ${t.integer} NOT NULL,
         last_error ${t.text},
         run_after ${t.timestamp} NOT NULL,
         create_date ${t.timestamp} NOT NULL,
         update_date ${t.timestamp} NOT NULL
       )`,
    )
    await db.exec('CREATE INDEX ix_content_event_due ON content_event (state, run_after)')
    await db.exec(`ALTER TABLE webhook_delivery ADD COLUMN event_id ${t.varchar(64)}`)
    await db.exec(
      'CREATE UNIQUE INDEX ux_webhook_delivery_event ON webhook_delivery (event_id, subscriber)',
    )
    await db.exec(`ALTER TABLE content_notification ADD COLUMN event_id ${t.varchar(64)}`)
    await db.exec(
      `CREATE UNIQUE INDEX ux_content_notification_event
         ON content_notification (event_id, recipient_user_key, action_id)`,
    )
  },
}
