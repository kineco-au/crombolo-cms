/**
 * Migration 104 — every webhook event named `Crombolo.` and its word (story 440). A webhook
 * kept in the database names its events as the back office chose them, so it is renamed
 * here; what a person or a package writes with an old name is refused where it is read.
 * Story 441: and the workflows a webhook hears approvals of (`webhook.workflows`).
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_MEMBER_PASSWORD_RESET } from './member-password-reset.ts'

export const STATE_WEBHOOK_EVENT_NAMES = '{2a7c4e19-0104-4b3d-8e52-6f1a9d3c0104}'

const WORDS = [
  'ContentSaved',
  'ContentPublish',
  'ContentUnpublish',
  'ContentDelete',
  'ContentMovedToRecycleBin',
  'ContentMoved',
  'ContentCopied',
  'ContentSorted',
  'ContentRolledBack',
  'ContentEmptiedRecycleBin',
  'MediaSave',
  'MediaDelete',
]

/** Each name a stored webhook may hold from before, and its name now. */
export const WEBHOOK_EVENTS_RENAMED: Readonly<Record<string, string>> = {
  ...Object.fromEntries(WORDS.map((word) => [`Umbraco.${word}`, `Crombolo.${word}`])),
  mediaMoved: 'Crombolo.MediaMoved',
  mediaMovedToRecycleBin: 'Crombolo.MediaMovedToRecycleBin',
  mediaEmptiedRecycleBin: 'Crombolo.MediaEmptiedRecycleBin',
}

export const webhookEventNamesMigration: Migration = {
  from: STATE_MEMBER_PASSWORD_RESET,
  to: STATE_WEBHOOK_EVENT_NAMES,
  name: 'RenameWebhookEvents',
  kind: 'expand',
  release: '0.82.0',
  async up(db: Db) {
    await db.q.schema
      .alterTable('webhook')
      .addColumn('workflows', sql.raw(db.dialect.types.text))
      .execute()
    // Each name as its own quoted list entry, renamed in place: nothing is read, so the
    // upgrade plan shows every statement.
    for (const [old, now] of Object.entries(WEBHOOK_EVENTS_RENAMED))
      await db.q
        .updateTable('webhook')
        .set({
          events: sql<string>`replace(events, ${JSON.stringify(old)}, ${JSON.stringify(now)})`,
        })
        .execute()
  },
}
