/**
 * Migration 048 — the AI assistant leaves the CMS (story 179), and its
 * changesets with it. Migration 017 created the two tables and stays in the
 * chain as history. `IF EXISTS`, so a replay is harmless.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_CONTENT_CHECKPOINT } from './content-checkpoint.ts'

export const STATE_DROP_ASSISTANT = '{9c4a1e72-0048-4b5d-8e26-7f3d1a9c5b48}'

export const dropAssistantMigration: Migration = {
  from: STATE_CONTENT_CHECKPOINT,
  to: STATE_DROP_ASSISTANT,
  name: 'DropAssistantTables',
  kind: 'contract',
  contracts: 'AddAssistantChangesets',
  release: '0.26.0',
  async up(db: Db) {
    await db.exec('DROP TABLE IF EXISTS assistant_change')
    await db.exec('DROP TABLE IF EXISTS assistant_changeset')
  },
}
