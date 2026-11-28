/**
 * Migration 109 — a workspace's colour, chosen by its owner from the palette (story 384's
 * colours). Empty until chosen: the back office then gives it one from its key, as before.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_FILE_TYPE_WORDING } from './file-type-wording.ts'

export const STATE_WORKSPACE_COLOUR = '{8e3a1d56-0109-4b72-a6f4-2c9d0e1b0109}'

export const workspaceColourMigration: Migration = {
  from: STATE_FILE_TYPE_WORDING,
  to: STATE_WORKSPACE_COLOUR,
  name: 'AddWorkspaceColour',
  kind: 'expand',
  release: '0.85.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .alterTable('workspace')
      .addColumn('colour', sql.raw(t.varchar(7)))
      .execute()
  },
}
